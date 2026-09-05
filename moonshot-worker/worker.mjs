/**
 * Moonshot companion worker for CLI Proxy API management panel.
 * Starts / stops a Claude Code session on a selectable Kimi model and reports status.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');
const LOG_PATH = path.join(__dirname, 'worker.log');
const SESSION_BAT = path.join(__dirname, 'session.bat');
const PROXY_EXE = path.join(ROOT, 'cli-proxy-api.exe');
const PROXY_CONFIG = path.join(ROOT, 'config.yaml');
const MODEL_ROUTER_SRC = path.join(ROOT, 'model-router');
const CLAUDE_HOME = path.join(HOME, '.claude');
const CURSOR_SKILLS = path.join(HOME, '.cursor', 'skills');
const CURSOR_ROUTING_PY = path.join(__dirname, 'cursor-routing.py');
const CURSOR_ROUTING_BACKUP = path.join(__dirname, 'cursor-routing-backup.json');
const CURSOR_SETTINGS = path.join(
  process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'),
  'Cursor',
  'User',
  'settings.json'
);

/** Other Operate session companions — only one mode should own MODEL_ROUTER_* / Cursor at a time. */
const SIBLING_SESSION_PORTS = [19889, 19891, 19892, 19893];

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_KIMI_MODELS = [
  'kimi-k3',
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2',
  'kimi-k2-thinking',
];

const DEFAULT_CONFIG = {
  listenHost: '127.0.0.1',
  listenPort: 19891,
  cpaBaseUrl: 'http://127.0.0.1:8317',
  apiKey: 'CHANGE_ME_LOCAL_SECRET',
  sessionModel: 'kimi-k3',
  sessionEffort: 'high',
  heartbeatSeconds: 15,
  tokenPingEnabled: false,
  tokenPingSeconds: 300,
};

/** @type {{ skills: boolean, settings: boolean, userEnv: boolean, cursorEnv: boolean, cursorRouting: boolean, notes: string[] }} */
let lastBootstrap = {
  skills: false,
  settings: false,
  userEnv: false,
  cursorEnv: false,
  cursorRouting: false,
  notes: [],
};

/** @type {{ ok: boolean, applied?: boolean, restored?: boolean, openAIBaseUrl?: string | null, useOpenAIKey?: boolean | null, model?: string, reloadRequired?: boolean, error?: string }} */
let lastCursorRouting = { ok: false };

/** @type {typeof DEFAULT_CONFIG} */
let config = loadConfig();

/** @type {{ enabled: boolean, pid: number | null, startedAt: number | null, lastError: string | null, lastActionAt: number | null }} */
let state = loadState();

/** @type {{ ok: boolean, lastAt: number | null, lastError: string | null, lastTokenPingAt: number | null, lastTokenPingOk: boolean | null, lastTokenPingTokens: number | null, lastTokenPingError: string | null }} */
let heartbeat = {
  ok: false,
  lastAt: null,
  lastError: null,
  lastTokenPingAt: null,
  lastTokenPingOk: null,
  lastTokenPingTokens: null,
  lastTokenPingError: null,
};

/** @type {ReturnType<typeof setInterval> | null} */
let heartbeatTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let tokenPingTimer = null;

function isKimiModelId(id) {
  const value = String(id || '').trim().toLowerCase();
  return value.startsWith('kimi-') || value.startsWith('moonshot-');
}

function normalizeEffort(value, fallback) {
  const v = String(value || '').trim().toLowerCase();
  return EFFORTS.includes(v) ? v : fallback;
}

function clampSeconds(value, fallback, max = 3600) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.floor(n));
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    log(`Failed to read ${path.basename(filePath)}: ${err.message}`);
    return structuredClone(fallback);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadConfig() {
  const loaded = readJson(CONFIG_PATH, DEFAULT_CONFIG);
  const sessionModel = String(loaded.sessionModel || DEFAULT_CONFIG.sessionModel).trim();
  return {
    listenHost: String(loaded.listenHost || DEFAULT_CONFIG.listenHost),
    listenPort: Number(loaded.listenPort) || DEFAULT_CONFIG.listenPort,
    cpaBaseUrl: String(loaded.cpaBaseUrl || DEFAULT_CONFIG.cpaBaseUrl).replace(/\/+$/, ''),
    apiKey: String(loaded.apiKey || DEFAULT_CONFIG.apiKey),
    sessionModel: sessionModel || DEFAULT_CONFIG.sessionModel,
    sessionEffort: normalizeEffort(loaded.sessionEffort, DEFAULT_CONFIG.sessionEffort),
    heartbeatSeconds: clampSeconds(loaded.heartbeatSeconds, DEFAULT_CONFIG.heartbeatSeconds),
    tokenPingEnabled: Boolean(loaded.tokenPingEnabled),
    tokenPingSeconds: clampSeconds(loaded.tokenPingSeconds, DEFAULT_CONFIG.tokenPingSeconds),
  };
}

function saveConfig() {
  writeJson(CONFIG_PATH, config);
}

function loadState() {
  return readJson(STATE_PATH, {
    enabled: false,
    pid: null,
    startedAt: null,
    lastError: null,
    lastActionAt: null,
  });
}

function saveState() {
  writeJson(STATE_PATH, state);
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop FabSol / FabKim so Moonshot owns a pure Kimi session (no Claude orchestrator mix). */
async function stopSiblingSessions() {
  const ports = SIBLING_SESSION_PORTS.filter((port) => port !== config.listenPort);
  await Promise.all(
    ports.map(async (port) => {
      try {
        await fetch(`http://127.0.0.1:${port}/enabled`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
          signal: AbortSignal.timeout(4000),
        });
        log(`sibling session on :${port} stopped for Moonshot`);
      } catch {
        // sibling worker offline — fine
      }
    })
  );
}

async function ensureProxyRunning() {
  try {
    const response = await fetch(`${config.cpaBaseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) return true;
  } catch {
    // start below
  }

  if (!fs.existsSync(PROXY_EXE) || !fs.existsSync(PROXY_CONFIG)) {
    throw new Error('cli-proxy-api.exe or config.yaml missing');
  }

  log('Proxy not reachable — starting cli-proxy-api.exe');
  const child = spawn(PROXY_EXE, ['--config', PROXY_CONFIG], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const response = await fetch(`${config.cpaBaseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // retry
    }
  }
  throw new Error('Proxy failed to become ready on ' + config.cpaBaseUrl);
}

async function probeProxy() {
  try {
    const response = await fetch(`${config.cpaBaseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return { ok: false, models: [], kimiModels: [], error: `HTTP ${response.status}` };
    }
    const body = await response.json();
    const ids = Array.isArray(body?.data) ? body.data.map((m) => m.id).filter(Boolean) : [];
    const kimiModels = ids.filter(isKimiModelId);
    return {
      ok: true,
      models: ids,
      kimiModels,
      hasSessionModel: ids.includes(config.sessionModel),
      error: null,
    };
  } catch (err) {
    return { ok: false, models: [], kimiModels: [], error: err.message || String(err) };
  }
}

async function runHeartbeatProbe() {
  const proxy = await probeProxy();
  heartbeat.lastAt = Date.now();
  heartbeat.ok = Boolean(proxy.ok && proxy.hasSessionModel);
  heartbeat.lastError = proxy.ok
    ? proxy.hasSessionModel
      ? null
      : `Kimi model missing: ${config.sessionModel}`
    : proxy.error || 'proxy unreachable';
  return proxy;
}

async function runTokenPing() {
  const payload = {
    model: config.sessionModel,
    max_tokens: 5,
    messages: [{ role: 'user', content: 'Reply with exactly: 1' }],
  };
  try {
    const response = await fetch(`${config.cpaBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    heartbeat.lastTokenPingAt = Date.now();
    if (!response.ok) {
      heartbeat.lastTokenPingOk = false;
      heartbeat.lastTokenPingTokens = null;
      heartbeat.lastTokenPingError =
        (body && (body.error?.message || body.error)) || `HTTP ${response.status}`;
      return;
    }
    const usage = body?.usage || {};
    const total =
      Number(usage.total_tokens) ||
      (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0) ||
      null;
    heartbeat.lastTokenPingOk = true;
    heartbeat.lastTokenPingTokens = total;
    heartbeat.lastTokenPingError = null;
  } catch (err) {
    heartbeat.lastTokenPingAt = Date.now();
    heartbeat.lastTokenPingOk = false;
    heartbeat.lastTokenPingTokens = null;
    heartbeat.lastTokenPingError = err.message || String(err);
  }
}

function restartHeartbeatTimers() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (tokenPingTimer) {
    clearInterval(tokenPingTimer);
    tokenPingTimer = null;
  }

  if (config.heartbeatSeconds > 0) {
    void runHeartbeatProbe();
    heartbeatTimer = setInterval(() => {
      void runHeartbeatProbe();
    }, config.heartbeatSeconds * 1000);
  }

  if (config.tokenPingEnabled && config.tokenPingSeconds > 0) {
    void runTokenPing();
    tokenPingTimer = setInterval(() => {
      void runTokenPing();
    }, config.tokenPingSeconds * 1000);
  }
}

function writeSessionBat() {
  const bat = `@echo off
REM Session launcher used by the Moonshot management worker.
REM Assumes CLIProxyAPI is already running on :8317.
setlocal
cd /d "%~dp0\\.."

set HTTPS_PROXY=
set HTTP_PROXY=
set ALL_PROXY=
set https_proxy=
set http_proxy=
set all_proxy=

set ANTHROPIC_BASE_URL=${config.cpaBaseUrl}
set ANTHROPIC_AUTH_TOKEN=${config.apiKey}
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
set MODEL_ROUTER_URL=${config.cpaBaseUrl}
set MODEL_ROUTER_KEY=${config.apiKey}
set MODEL_ROUTER_MODEL=${config.sessionModel}
set MODEL_ROUTER_EFFORT=${config.sessionEffort}
set CLIPROXY_DIR=%cd%

where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] claude not found in PATH.
  echo Install with: npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

title ClaudeMoonshot
echo Moonshot session ready via proxy :8317
echo   Kimi model: ${config.sessionModel} @ ${config.sessionEffort}
echo   Command:    /moonshot ^<brief^>
echo.
claude --model ${config.sessionModel} %*
endlocal
`;
  fs.writeFileSync(SESSION_BAT, bat.replace(/\n/g, '\r\n'), 'utf8');
}

async function findClaudeOnPath() {
  try {
    const { stdout } = await execFileAsync('where.exe', ['claude']);
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return line || null;
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileSafe(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return false;
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else copyFileSafe(from, to);
  }
  return true;
}

function routerEnv() {
  return {
    MODEL_ROUTER_URL: config.cpaBaseUrl,
    MODEL_ROUTER_KEY: config.apiKey,
    MODEL_ROUTER_MODEL: config.sessionModel,
    MODEL_ROUTER_EFFORT: config.sessionEffort,
    CLIPROXY_DIR: ROOT,
  };
}

function ensureMoonshotSkills() {
  const notes = [];
  if (!fs.existsSync(MODEL_ROUTER_SRC)) {
    notes.push('model-router folder missing next to cli-proxy-api.exe');
    return { ok: false, notes };
  }

  ensureDir(CLAUDE_HOME);
  const pairs = [
    [path.join(MODEL_ROUTER_SRC, 'skills', 'moonshot'), path.join(CLAUDE_HOME, 'skills', 'moonshot')],
    [path.join(MODEL_ROUTER_SRC, 'skills', 'model-router'), path.join(CLAUDE_HOME, 'skills', 'model-router')],
    [path.join(MODEL_ROUTER_SRC, 'commands'), path.join(CLAUDE_HOME, 'commands')],
    [path.join(MODEL_ROUTER_SRC, 'scripts'), path.join(CLAUDE_HOME, 'skills', 'model-router', 'scripts')],
    [path.join(MODEL_ROUTER_SRC, 'skills', 'moonshot'), path.join(CURSOR_SKILLS, 'moonshot')],
  ];

  for (const [src, dest] of pairs) {
    if (!fs.existsSync(src)) {
      notes.push(`missing source: ${path.relative(ROOT, src)}`);
      continue;
    }
    copyDirRecursive(src, dest);
  }

  const moonshotSkill = path.join(CLAUDE_HOME, 'skills', 'moonshot', 'SKILL.md');
  if (fs.existsSync(moonshotSkill)) {
    let text = fs.readFileSync(moonshotSkill, 'utf8');
    text = text
      .replaceAll('my-proxy-key', config.apiKey)
      .replace(/\| Session model \| `MODEL_ROUTER_MODEL` \| `kimi-k3` \|/g, `| Session model | \`MODEL_ROUTER_MODEL\` | \`${config.sessionModel}\` |`)
      .replace(/\| Effort \| `MODEL_ROUTER_EFFORT` \| `high` \|/g, `| Effort | \`MODEL_ROUTER_EFFORT\` | \`${config.sessionEffort}\` |`);
    fs.writeFileSync(moonshotSkill, text, 'utf8');
  }

  notes.push(`moonshot skills/commands synced into ${CLAUDE_HOME} and ${CURSOR_SKILLS}`);
  return { ok: true, notes };
}

function ensureClaudeSettings() {
  const settingsPath = path.join(CLAUDE_HOME, 'settings.json');
  ensureDir(CLAUDE_HOME);
  let current = {};
  try {
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    current = {};
  }

  const env = { ...(current.env || {}), ...routerEnv() };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const excluded = new Set([
    ...((current.sandbox && current.sandbox.excludedCommands) || []),
    'curl *',
    'claude *',
    'curl.exe *',
    'claude.exe *',
  ]);

  const next = {
    ...current,
    env,
    sandbox: {
      ...(current.sandbox || {}),
      enabled: current.sandbox?.enabled ?? true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: true,
      excludedCommands: [...excluded],
      network: {
        ...((current.sandbox && current.sandbox.network) || {}),
        allowLocalBinding: true,
        allowedDomains: Array.from(
          new Set([
            ...(((current.sandbox && current.sandbox.network && current.sandbox.network.allowedDomains) || [])),
            'localhost',
            '127.0.0.1',
          ])
        ),
      },
    },
  };

  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { ok: true, notes: [`updated ${settingsPath}`] };
}

async function ensureUserEnvVars() {
  const env = routerEnv();
  const notes = [];
  const tmpPs1 = path.join(__dirname, 'set-user-env.ps1');
  const lines = Object.entries(env).map(([name, value]) => {
    return [
      `$name = '${name.replace(/'/g, "''")}'`,
      `$value = '${String(value).replace(/'/g, "''")}'`,
      `$existing = [Environment]::GetEnvironmentVariable($name, 'User')`,
      `if ($existing -ne $value) { [Environment]::SetEnvironmentVariable($name, $value, 'User') }`,
    ].join('; ');
  });
  fs.writeFileSync(tmpPs1, `${lines.join('\n')}\nexit 0\n`, 'utf8');
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      tmpPs1,
    ]);
    for (const [name, value] of Object.entries(env)) process.env[name] = value;
    notes.push('user MODEL_ROUTER_* / CLIPROXY_DIR env vars set (new Cursor/Claude windows pick them up)');
    return { ok: true, notes };
  } catch (err) {
    notes.push(`failed to set user env: ${err.message}`);
    return { ok: false, notes };
  } finally {
    try {
      fs.unlinkSync(tmpPs1);
    } catch {
      // ignore
    }
  }
}

function ensureCursorTerminalEnv() {
  const notes = [];
  try {
    ensureDir(path.dirname(CURSOR_SETTINGS));
    let current = {};
    if (fs.existsSync(CURSOR_SETTINGS)) {
      current = JSON.parse(fs.readFileSync(CURSOR_SETTINGS, 'utf8'));
    }
    const env = routerEnv();
    const key = 'terminal.integrated.env.windows';
    current[key] = { ...(current[key] || {}), ...env };
    fs.writeFileSync(CURSOR_SETTINGS, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    notes.push(`Cursor terminal env updated (${CURSOR_SETTINGS})`);
    return { ok: true, notes };
  } catch (err) {
    notes.push(`Cursor settings skip: ${err.message}`);
    return { ok: false, notes };
  }
}

async function runCursorRouting(action, extraModels = []) {
  if (!fs.existsSync(CURSOR_ROUTING_PY)) {
    lastCursorRouting = { ok: false, error: 'cursor-routing.py missing' };
    return lastCursorRouting;
  }
  const baseUrl = `${config.cpaBaseUrl}/v1`;
  const models = Array.from(
    new Set([config.sessionModel, ...extraModels].filter(Boolean))
  ).join(',');
  try {
    const { stdout, stderr } = await execFileAsync('python', [
      CURSOR_ROUTING_PY,
      action,
      '--base-url',
      baseUrl,
      '--model',
      config.sessionModel,
      '--models',
      models,
      '--backup',
      CURSOR_ROUTING_BACKUP,
    ]);
    const text = String(stdout || '').trim() || String(stderr || '').trim();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || !parsed.ok) {
      lastCursorRouting = {
        ok: false,
        error: (parsed && parsed.error) || text || `cursor routing ${action} failed`,
      };
      return lastCursorRouting;
    }
    lastCursorRouting = { ...parsed, ok: true };
    return lastCursorRouting;
  } catch (err) {
    lastCursorRouting = { ok: false, error: err.message || String(err) };
    return lastCursorRouting;
  }
}

async function applyCursorMoonshotRouting(proxyKimiModels = []) {
  const result = await runCursorRouting('apply', proxyKimiModels);
  if (result.ok) {
    log(`Cursor routing applied → ${config.cpaBaseUrl}/v1 model=${config.sessionModel}`);
  } else {
    log(`Cursor routing apply failed: ${result.error}`);
  }
  return result;
}

async function restoreCursorMoonshotRouting() {
  const result = await runCursorRouting('restore');
  if (result.ok) {
    log('Cursor routing restored from backup');
  } else if (result.error) {
    log(`Cursor routing restore failed: ${result.error}`);
  }
  return result;
}

async function prepareMoonshotEnvironment(proxyKimiModels = []) {
  const notes = [];
  const skills = ensureMoonshotSkills();
  const settings = ensureClaudeSettings();
  const userEnv = await ensureUserEnvVars();
  const cursorEnv = ensureCursorTerminalEnv();
  const cursorRouting = await applyCursorMoonshotRouting(proxyKimiModels);
  if (cursorRouting.ok) {
    notes.push(
      `Cursor OpenAI override → ${config.cpaBaseUrl}/v1 (model ${config.sessionModel}). Reload Cursor window to apply. One-time: Settings → Models → OpenAI API Key = ${config.apiKey} (toggle On).`
    );
  } else {
    notes.push(`Cursor routing skipped: ${cursorRouting.error || 'unknown error'}`);
  }
  notes.push(...skills.notes, ...settings.notes, ...userEnv.notes, ...cursorEnv.notes);
  lastBootstrap = {
    skills: skills.ok,
    settings: settings.ok,
    userEnv: userEnv.ok,
    cursorEnv: cursorEnv.ok,
    cursorRouting: Boolean(cursorRouting.ok),
    notes,
  };
  for (const note of notes) log(`bootstrap: ${note}`);
  return lastBootstrap;
}

async function startSession() {
  state.lastActionAt = Date.now();
  state.lastError = null;

  await ensureProxyRunning();
  // FabKim/FabSol use Claude as the session model — yield so this session stays Kimi-only.
  await stopSiblingSessions();
  writeSessionBat();
  const proxy = await probeProxy();
  await prepareMoonshotEnvironment(proxy.kimiModels || []);

  if (state.pid && isPidAlive(state.pid)) {
    state.enabled = true;
    saveState();
    return getStatusPayload();
  }

  const claudePath = await findClaudeOnPath();
  if (!claudePath) {
    state.enabled = true;
    state.pid = null;
    state.startedAt = Date.now();
    state.lastError =
      'Claude Code CLI not found — Cursor Kimi routing was still applied. Install with: npm install -g @anthropic-ai/claude-code';
    saveState();
    log('Moonshot enabled (Cursor routing only; claude missing)');
    return getStatusPayload();
  }
  if (!fs.existsSync(SESSION_BAT)) {
    throw new Error('session.bat missing next to Moonshot worker');
  }

  const psScript = [
    `$p = Start-Process -FilePath 'cmd.exe'`,
    `-ArgumentList @('/k', '${SESSION_BAT.replace(/'/g, "''")}')`,
    `-WorkingDirectory '${ROOT.replace(/'/g, "''")}'`,
    `-PassThru`,
    `; Write-Output $p.Id`,
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    psScript,
  ]);
  const pid = Number(String(stdout).trim().split(/\r?\n/).filter(Boolean).pop());
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('Failed to start Moonshot session window');
  }

  state.enabled = true;
  state.pid = pid;
  state.startedAt = Date.now();
  state.lastError = null;
  saveState();
  log(`Moonshot session started pid=${pid} model=${config.sessionModel}`);
  return getStatusPayload();
}

async function stopSession() {
  state.lastActionAt = Date.now();
  const pid = state.pid;
  if (pid && isPidAlive(pid)) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
      log(`Moonshot session stopped pid=${pid}`);
    } catch (err) {
      log(`taskkill pid=${pid}: ${err.message}`);
    }
  }
  await restoreCursorMoonshotRouting();
  state.enabled = false;
  state.pid = null;
  state.startedAt = null;
  state.lastError = null;
  saveState();
  return getStatusPayload();
}

async function applyConfigUpdate(body = {}) {
  const next = { ...config };
  if (body.sessionModel != null) {
    const value = String(body.sessionModel).trim();
    if (!value) throw new Error('sessionModel is required');
    if (!isKimiModelId(value)) {
      throw new Error('sessionModel must be a kimi-* (or moonshot-*) model id');
    }
    next.sessionModel = value;
  }
  if (body.sessionEffort != null) {
    next.sessionEffort = normalizeEffort(body.sessionEffort, config.sessionEffort);
  }
  if (body.heartbeatSeconds != null) {
    next.heartbeatSeconds = clampSeconds(body.heartbeatSeconds, config.heartbeatSeconds);
  }
  if (body.tokenPingEnabled != null) {
    next.tokenPingEnabled = Boolean(body.tokenPingEnabled);
  }
  if (body.tokenPingSeconds != null) {
    next.tokenPingSeconds = clampSeconds(body.tokenPingSeconds, config.tokenPingSeconds);
  }

  config = next;
  saveConfig();
  writeSessionBat();
  restartHeartbeatTimers();
  const proxy = await probeProxy();
  if (state.enabled || (state.pid && isPidAlive(state.pid))) {
    await prepareMoonshotEnvironment(proxy.kimiModels || []);
  }
  return getStatusPayload();
}

async function getStatusPayload() {
  const running = Boolean(state.pid && isPidAlive(state.pid));
  if (state.enabled && state.pid && !running) {
    state.enabled = false;
    state.pid = null;
    state.startedAt = null;
    saveState();
  }

  const proxy = await probeProxy();
  const claudePath = await findClaudeOnPath();
  const kimiModels =
    proxy.kimiModels?.length > 0
      ? proxy.kimiModels
      : FALLBACK_KIMI_MODELS.includes(config.sessionModel)
        ? FALLBACK_KIMI_MODELS
        : [config.sessionModel, ...FALLBACK_KIMI_MODELS];

  return {
    ok: true,
    enabled: Boolean(state.enabled && running),
    running,
    pid: running ? state.pid : null,
    startedAt: running ? state.startedAt : null,
    lastError: state.lastError,
    lastActionAt: state.lastActionAt,
    proxyOk: proxy.ok,
    proxyError: proxy.error,
    hasSessionModel: Boolean(proxy.hasSessionModel),
    sessionModel: config.sessionModel,
    sessionEffort: config.sessionEffort,
    kimiModels,
    efforts: EFFORTS,
    cpaBaseUrl: config.cpaBaseUrl,
    claudeAvailable: Boolean(claudePath),
    claudePath,
    bootstrap: lastBootstrap,
    cursorRouting: {
      ok: Boolean(lastCursorRouting.ok),
      applied: Boolean(lastCursorRouting.applied),
      restored: Boolean(lastCursorRouting.restored),
      openAIBaseUrl: lastCursorRouting.openAIBaseUrl ?? null,
      useOpenAIKey: lastCursorRouting.useOpenAIKey ?? null,
      model: lastCursorRouting.model || config.sessionModel,
      reloadRequired: Boolean(lastCursorRouting.reloadRequired),
      error: lastCursorRouting.error || null,
      apiKeyHint: config.apiKey,
      baseUrlHint: `${config.cpaBaseUrl}/v1`,
      backupExists: fs.existsSync(CURSOR_ROUTING_BACKUP),
    },
    heartbeat: {
      ok: heartbeat.ok,
      lastAt: heartbeat.lastAt,
      lastError: heartbeat.lastError,
      intervalSeconds: config.heartbeatSeconds,
      tokenPingEnabled: config.tokenPingEnabled,
      tokenPingSeconds: config.tokenPingSeconds,
      lastTokenPingAt: heartbeat.lastTokenPingAt,
      lastTokenPingOk: heartbeat.lastTokenPingOk,
      lastTokenPingTokens: heartbeat.lastTokenPingTokens,
      lastTokenPingError: heartbeat.lastTokenPingError,
    },
  };
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${config.listenHost}:${config.listenPort}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/status') {
      sendJson(res, 200, await getStatusPayload());
      return;
    }

    if (req.method === 'POST' && pathname === '/start') {
      try {
        const status = await startSession();
        sendJson(res, 200, status);
      } catch (err) {
        state.lastError = err.message || String(err);
        state.enabled = false;
        saveState();
        sendJson(res, 500, { ok: false, error: state.lastError, ...(await getStatusPayload()) });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/stop') {
      sendJson(res, 200, await stopSession());
      return;
    }

    if (req.method === 'PUT' && pathname === '/enabled') {
      const body = await readBody(req);
      const enabled = Boolean(body.enabled);
      try {
        const status = enabled ? await startSession() : await stopSession();
        sendJson(res, 200, status);
      } catch (err) {
        state.lastError = err.message || String(err);
        saveState();
        sendJson(res, 500, { ok: false, error: state.lastError, ...(await getStatusPayload()) });
      }
      return;
    }

    if (req.method === 'PUT' && pathname === '/config') {
      const body = await readBody(req);
      sendJson(res, 200, await applyConfigUpdate(body));
      return;
    }

    if (req.method === 'POST' && pathname === '/cursor-routing/apply') {
      const proxy = await probeProxy();
      await applyCursorMoonshotRouting(proxy.kimiModels || []);
      sendJson(res, 200, await getStatusPayload());
      return;
    }

    if (req.method === 'POST' && pathname === '/cursor-routing/restore') {
      await restoreCursorMoonshotRouting();
      sendJson(res, 200, await getStatusPayload());
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log(`request error: ${err.message}`);
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
});

writeSessionBat();
restartHeartbeatTimers();
server.listen(config.listenPort, config.listenHost, () => {
  log(`Moonshot worker listening on http://${config.listenHost}:${config.listenPort}`);
});
