/**
 * Claude 5-hour auto-start companion for CLI Proxy API.
 * Polls usage; when the 5-hour window is inactive, sends a tiny messages request.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const LOG_PATH = path.join(__dirname, 'worker.log');

const DEFAULT_SETTINGS = {
  globalEnabled: false,
  checkIntervalSeconds: 180,
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 8,
  accounts: {},
};

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const PING_COOLDOWN_MS = 15 * 60 * 1000;
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 3600;

/** @type {ReturnType<typeof loadConfig>} */
let config = loadConfig();
/** @type {typeof DEFAULT_SETTINGS} */
let settings = loadSettings();
/** @type {Map<string, { lastPingAt: number | null, lastResult: string, lastError: string | null, lastCheckedAt: number | null, needsStart: boolean | null }>} */
const accountState = new Map();
let lastLoopAt = null;
let lastLoopError = null;
let loopTimer = null;
let looping = false;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  } catch {
    // ignore log write failures
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch (err) {
    log(`Failed to read ${path.basename(filePath)}: ${err.message}`);
    return structuredClone(fallback);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadConfig() {
  const fallback = {
    cpaBaseUrl: 'http://127.0.0.1:9999',
    managementKey: 'CHANGE_ME_LOCAL_SECRET',
    listenHost: '127.0.0.1',
    listenPort: 19888,
  };
  const loaded = readJson(CONFIG_PATH, fallback);
  return {
    cpaBaseUrl: String(loaded.cpaBaseUrl || fallback.cpaBaseUrl).replace(/\/+$/, ''),
    managementKey: String(loaded.managementKey || fallback.managementKey),
    listenHost: String(loaded.listenHost || fallback.listenHost),
    listenPort: Number(loaded.listenPort) || fallback.listenPort,
  };
}

function normalizeSettings(input) {
  const next = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(input && typeof input === 'object' ? input : {}),
  };
  next.globalEnabled = Boolean(next.globalEnabled);
  next.checkIntervalSeconds = Math.min(
    MAX_INTERVAL_SECONDS,
    Math.max(MIN_INTERVAL_SECONDS, Number(next.checkIntervalSeconds) || DEFAULT_SETTINGS.checkIntervalSeconds)
  );
  next.model = String(next.model || DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model;
  next.maxTokens = Math.min(10, Math.max(1, Number(next.maxTokens) || DEFAULT_SETTINGS.maxTokens));
  next.accounts =
    next.accounts && typeof next.accounts === 'object' && !Array.isArray(next.accounts)
      ? next.accounts
      : {};
  return next;
}

function loadSettings() {
  return normalizeSettings(readJson(SETTINGS_PATH, DEFAULT_SETTINGS));
}

function saveSettings(next) {
  settings = normalizeSettings(next);
  writeJson(SETTINGS_PATH, settings);
  scheduleLoop(true);
  return settings;
}

function managementUrl(pathname) {
  return `${config.cpaBaseUrl}/v0/management${pathname}`;
}

async function managementFetch(pathname, options = {}) {
  const response = await fetch(managementUrl(pathname), {
    ...options,
    headers: {
      Authorization: `Bearer ${config.managementKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === 'object' && body ? JSON.stringify(body) : String(body || '');
    throw new Error(`CPA ${response.status} ${pathname}: ${detail || response.statusText}`);
  }
  return body;
}

async function apiCall(payload) {
  const result = await managementFetch('/api-call', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const statusCode = Number(result?.status_code ?? result?.statusCode ?? 0);
  let body = result?.body ?? null;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // keep string
    }
  }
  return {
    statusCode,
    body,
    bodyText: typeof result?.body === 'string' ? result.body : JSON.stringify(result?.body ?? ''),
  };
}

function isClaudeFile(file) {
  const provider = String(file?.provider ?? file?.type ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return provider === 'claude';
}

function isDisabled(file) {
  const raw = file?.disabled;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

function accountEnabled(name) {
  if (!settings.globalEnabled) return false;
  const entry = settings.accounts?.[name];
  if (entry && typeof entry === 'object' && entry.enabled === false) return false;
  return true;
}

function fiveHourNeedsStart(usage) {
  const five = usage?.five_hour;
  if (!five || typeof five !== 'object') return true;
  const resetsAt = five.resets_at ?? five.resetsAt;
  if (!resetsAt) return true;
  const resetMs = Date.parse(String(resetsAt));
  if (Number.isNaN(resetMs)) return true;
  return resetMs <= Date.now();
}

function getAccountRuntime(name) {
  if (!accountState.has(name)) {
    accountState.set(name, {
      lastPingAt: null,
      lastResult: 'idle',
      lastError: null,
      lastCheckedAt: null,
      needsStart: null,
    });
  }
  return accountState.get(name);
}

async function listClaudeFiles() {
  const payload = await managementFetch('/auth-files');
  const files = Array.isArray(payload?.files) ? payload.files : [];
  return files.filter((file) => isClaudeFile(file) && !isDisabled(file));
}

async function fetchUsage(authIndex) {
  const result = await apiCall({
    authIndex,
    method: 'GET',
    url: CLAUDE_USAGE_URL,
    header: {
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`usage HTTP ${result.statusCode}: ${result.bodyText.slice(0, 240)}`);
  }
  if (!result.body || typeof result.body !== 'object') {
    throw new Error('usage payload empty');
  }
  return result.body;
}

async function pingStart(authIndex, model, maxTokens) {
  const result = await apiCall({
    authIndex,
    method: 'POST',
    url: CLAUDE_MESSAGES_URL,
    header: {
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
    },
    data: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: '.' }],
    }),
  });
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`ping HTTP ${result.statusCode}: ${result.bodyText.slice(0, 240)}`);
  }
  return result;
}

async function processAccount(file) {
  const name = String(file.name || file.id || '');
  const authIndex = String(file.auth_index ?? file.authIndex ?? '').trim();
  const runtime = getAccountRuntime(name);
  runtime.lastCheckedAt = Date.now();

  if (!accountEnabled(name)) {
    runtime.lastResult = 'disabled';
    runtime.needsStart = null;
    return;
  }
  if (!authIndex) {
    runtime.lastResult = 'error';
    runtime.lastError = 'missing auth_index';
    return;
  }

  const usage = await fetchUsage(authIndex);
  const needsStart = fiveHourNeedsStart(usage);
  runtime.needsStart = needsStart;

  if (!needsStart) {
    runtime.lastResult = 'window_active';
    runtime.lastError = null;
    return;
  }

  if (runtime.lastPingAt && Date.now() - runtime.lastPingAt < PING_COOLDOWN_MS) {
    runtime.lastResult = 'cooldown';
    return;
  }

  log(`Auto-starting 5-hour window for ${name}`);
  await pingStart(authIndex, settings.model, settings.maxTokens);
  runtime.lastPingAt = Date.now();
  runtime.lastResult = 'pinged';
  runtime.lastError = null;
  log(`Ping OK for ${name}`);
}

async function runLoop() {
  if (looping) {
    // Wait briefly for an in-flight loop so /run-once is not a no-op.
    for (let i = 0; i < 50 && looping; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (looping) return;
  }
  looping = true;
  lastLoopAt = Date.now();
  lastLoopError = null;
  try {
    config = loadConfig();
    if (!settings.globalEnabled) {
      return;
    }
    const files = await listClaudeFiles();
    for (const file of files) {
      const name = String(file.name || file.id || '');
      try {
        await processAccount(file);
      } catch (err) {
        const runtime = getAccountRuntime(name);
        runtime.lastResult = 'error';
        runtime.lastError = err instanceof Error ? err.message : String(err);
        log(`Account ${name} error: ${runtime.lastError}`);
      }
    }
  } catch (err) {
    lastLoopError = err instanceof Error ? err.message : String(err);
    log(`Loop error: ${lastLoopError}`);
  } finally {
    looping = false;
  }
}

function scheduleLoop(runImmediately = false) {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  const intervalMs = settings.checkIntervalSeconds * 1000;
  loopTimer = setInterval(() => {
    void runLoop();
  }, intervalMs);
  if (runImmediately) {
    void runLoop();
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function buildStatus() {
  const accounts = {};
  for (const [name, state] of accountState.entries()) {
    accounts[name] = {
      enabled: accountEnabled(name),
      ...state,
    };
  }
  return {
    ok: true,
    globalEnabled: settings.globalEnabled,
    checkIntervalSeconds: settings.checkIntervalSeconds,
    model: settings.model,
    maxTokens: settings.maxTokens,
    lastLoopAt,
    lastLoopError,
    accounts,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${config.listenHost}:${config.listenPort}`);
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/settings') {
      sendJson(res, 200, settings);
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/settings') {
      const body = await readBody(req);
      const merged = {
        ...settings,
        ...body,
        accounts: {
          ...settings.accounts,
          ...(body.accounts && typeof body.accounts === 'object' ? body.accounts : {}),
        },
      };
      sendJson(res, 200, saveSettings(merged));
      return;
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/settings/accounts/')) {
      const name = decodeURIComponent(url.pathname.slice('/settings/accounts/'.length));
      if (!name) {
        sendJson(res, 400, { error: 'missing account name' });
        return;
      }
      const body = await readBody(req);
      const enabled = body.enabled !== false;
      const next = {
        ...settings,
        accounts: {
          ...settings.accounts,
          [name]: { ...(settings.accounts[name] || {}), enabled },
        },
      };
      sendJson(res, 200, saveSettings(next));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, buildStatus());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/run-once') {
      await runLoop();
      sendJson(res, 200, buildStatus());
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(config.listenPort, config.listenHost, () => {
  log(
    `Claude auto-start worker listening on http://${config.listenHost}:${config.listenPort} (global=${settings.globalEnabled})`
  );
  scheduleLoop(true);
});

process.on('SIGINT', () => {
  log('Shutting down');
  if (loopTimer) clearInterval(loopTimer);
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  log('Shutting down');
  if (loopTimer) clearInterval(loopTimer);
  server.close(() => process.exit(0));
});
