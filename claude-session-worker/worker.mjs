import { isWindows, proxyName, cursorSettingsPath, findClaude, launchMacSession, stopAgentProcess } from '../tools/platform.mjs';
/**
 * Claude-only companion worker for CLI Proxy API management panel.
 * Starts / stops a native Claude Code session (direct login, never the proxy).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');
const LOG_PATH = path.join(__dirname, 'worker.log');
const SESSION_BAT = path.join(__dirname, 'session.bat');
const MODEL_ROUTER_SRC = path.join(ROOT, 'model-router');
const CLAUDE_HOME = path.join(HOME, '.claude');
const CURSOR_SKILLS = path.join(HOME, '.cursor', 'skills');
const CURSOR_SETTINGS = cursorSettingsPath(HOME);
const MOONSHOT_DIR = path.join(ROOT, 'moonshot-worker');
const CURSOR_ROUTING_PY = path.join(MOONSHOT_DIR, 'cursor-routing.py');
const CURSOR_ROUTING_BACKUP = path.join(MOONSHOT_DIR, 'cursor-routing-backup.json');

/** Other Operate session companions — only one mode should own the terminal / Cursor at a time. */
const SIBLING_SESSION_PORTS = [19889, 19891, 19892, 19893];

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_CLAUDE_MODELS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

const DEFAULT_CONFIG = {
  listenHost: '127.0.0.1',
  listenPort: 19893,
  sessionModel: 'claude-fable-5',
  sessionEffort: 'high',
  heartbeatSeconds: 15,
  tokenPingEnabled: false,
  tokenPingSeconds: 300,
};

/** @type {{ skills: boolean, settings: boolean, cursorEnv: boolean, cursorRouting: boolean, notes: string[] }} */
let lastBootstrap = {
  skills: false,
  settings: false,
  cursorEnv: false,
  cursorRouting: false,
  notes: [],
};

/** @type {{ ok: boolean, restored?: boolean, error?: string }} */
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

function isClaudeModelId(id) {
  const value = String(id || '').trim().toLowerCase();
  return value.startsWith('claude-');
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

function nativeClaudeEnv(base = process.env) {
  const env = { ...base };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY;
  return env;
}

/** Stop FabSol / FabKim / Moonshot so this session stays Claude-only. */
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
        log(`sibling session on :${port} stopped for Claude`);
      } catch {
        // sibling worker offline — fine
      }
    })
  );
}

async function findClaudeOnPath() { return findClaude(); }

function findClaudeCredentials() {
  const candidates = [
    path.join(HOME, '.claude', '.credentials.json'),
    path.join(HOME, '.claude', 'credentials.json'),
    path.join(HOME, '.claude.json'),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || null;
}

async function runHeartbeatProbe() {
  const claudePath = await findClaudeOnPath();
  heartbeat.lastAt = Date.now();
  heartbeat.ok = Boolean(claudePath);
  heartbeat.lastError = claudePath ? null : 'Claude Code CLI not found in PATH';
  return { claudePath, credentialsPath: findClaudeCredentials() };
}

async function runTokenPing() {
  const claudePath = await findClaudeOnPath();
  heartbeat.lastTokenPingAt = Date.now();
  if (!claudePath) {
    heartbeat.lastTokenPingOk = false;
    heartbeat.lastTokenPingTokens = null;
    heartbeat.lastTokenPingError = 'claude not found in PATH';
    return;
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'claude',
      [
        '-p',
        'Reply with exactly: 1',
        '--model',
        config.sessionModel,
        '--bare',
        '--max-turns',
        '1',
      ],
      {
        env: nativeClaudeEnv(),
        timeout: 25000,
        cwd: ROOT,
      }
    );
    const text = `${stdout || ''}${stderr || ''}`.trim();
    heartbeat.lastTokenPingOk = Boolean(text);
    heartbeat.lastTokenPingTokens = text ? 1 : null;
    heartbeat.lastTokenPingError = text ? null : 'empty Claude ping response';
  } catch (err) {
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
  if (!isWindows) return;
  const bat = `@echo off
REM Session launcher used by the Claude-only management worker.
REM Uses the native Claude login — do NOT route this session through the proxy.
setlocal
cd /d "%~dp0\\.."

set HTTPS_PROXY=
set HTTP_PROXY=
set ALL_PROXY=
set https_proxy=
set http_proxy=
set all_proxy=

set ANTHROPIC_BASE_URL=
set ANTHROPIC_AUTH_TOKEN=
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=
set CLIPROXY_DIR=%cd%

where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] claude not found in PATH.
  echo Install with: npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

title ClaudeSession
echo Claude-only session (direct login, no proxy)
echo   Model: ${config.sessionModel} @ ${config.sessionEffort}
echo   Command:    /claude ^<brief^>
echo.
claude --model ${config.sessionModel} %*
endlocal
`;
  fs.writeFileSync(SESSION_BAT, bat.replace(/\n/g, '\r\n'), 'utf8');
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

function ensureClaudeSkills() {
  const notes = [];
  if (!fs.existsSync(MODEL_ROUTER_SRC)) {
    notes.push('model-router folder missing next to cli-proxy-api.exe');
    return { ok: false, notes };
  }

  ensureDir(CLAUDE_HOME);
  const pairs = [
    [path.join(MODEL_ROUTER_SRC, 'skills', 'claude'), path.join(CLAUDE_HOME, 'skills', 'claude')],
    [path.join(MODEL_ROUTER_SRC, 'skills', 'claude'), path.join(CURSOR_SKILLS, 'claude')],
    [path.join(MODEL_ROUTER_SRC, 'skills', 'model-router'), path.join(CLAUDE_HOME, 'skills', 'model-router')],
    [path.join(MODEL_ROUTER_SRC, 'commands'), path.join(CLAUDE_HOME, 'commands')],
  ];

  for (const [src, dest] of pairs) {
    if (!fs.existsSync(src)) {
      notes.push(`missing source: ${path.relative(ROOT, src)}`);
      continue;
    }
    copyDirRecursive(src, dest);
  }

  notes.push(`claude skills/commands synced into ${CLAUDE_HOME} and ${CURSOR_SKILLS}`);
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

  const env = { ...(current.env || {}) };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY;
  env.CLIPROXY_DIR = ROOT;

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
  return { ok: true, notes: [`updated ${settingsPath} (native Claude login, no proxy env)`] };
}

async function clearUserProxyEnv() {
  if (!isWindows) return { ok: true, notes: ['Direct Claude session clears inherited routing locally.'] };
  const notes = [];
  const names = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'];
  const tmpPs1 = path.join(__dirname, 'clear-user-env.ps1');
  const lines = names.map((name) => {
    return [
      `$name = '${name.replace(/'/g, "''")}'`,
      `if ([Environment]::GetEnvironmentVariable($name, 'User')) { [Environment]::SetEnvironmentVariable($name, $null, 'User') }`,
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
    for (const name of names) delete process.env[name];
    notes.push('cleared user ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN so Claude stays on direct login');
    return { ok: true, notes };
  } catch (err) {
    notes.push(`failed to clear user proxy env: ${err.message}`);
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
    const key = isWindows ? 'terminal.integrated.env.windows' : 'terminal.integrated.env.osx';
    const env = { ...(current[key] || {}) };
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY;
    env.CLIPROXY_DIR = ROOT;
    current[key] = env;
    fs.writeFileSync(CURSOR_SETTINGS, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    notes.push(`Cursor terminal env cleared of proxy Anthropic vars (${CURSOR_SETTINGS})`);
    return { ok: true, notes };
  } catch (err) {
    notes.push(`Cursor settings skip: ${err.message}`);
    return { ok: false, notes };
  }
}

async function restoreCursorRouting() {
  if (!fs.existsSync(CURSOR_ROUTING_PY)) {
    lastCursorRouting = { ok: true, restored: false };
    return lastCursorRouting;
  }
  if (!fs.existsSync(CURSOR_ROUTING_BACKUP)) {
    lastCursorRouting = { ok: true, restored: false };
    return lastCursorRouting;
  }
  try {
    const { stdout, stderr } = await execFileAsync(isWindows ? 'python' : 'python3', [
      CURSOR_ROUTING_PY,
      'restore',
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
    lastCursorRouting = parsed && parsed.ok ? { ...parsed, ok: true } : { ok: true, restored: false };
    if (lastCursorRouting.restored) {
      log('Cursor OpenAI override restored (Claude-only does not route Cursor through the proxy)');
    }
    return lastCursorRouting;
  } catch (err) {
    lastCursorRouting = { ok: false, error: err.message || String(err) };
    log(`Cursor routing restore failed: ${lastCursorRouting.error}`);
    return lastCursorRouting;
  }
}

async function prepareClaudeEnvironment() {
  const notes = [];
  const skills = ensureClaudeSkills();
  const settings = ensureClaudeSettings();
  const userEnv = await clearUserProxyEnv();
  const cursorEnv = ensureCursorTerminalEnv();
  const cursorRouting = await restoreCursorRouting();
  if (cursorRouting.restored) {
    notes.push('Cursor OpenAI override restored so this IDE uses Claude again. Reload Cursor window.');
  }
  notes.push(...skills.notes, ...settings.notes, ...userEnv.notes, ...cursorEnv.notes);
  lastBootstrap = {
    skills: skills.ok,
    settings: settings.ok,
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

  await stopSiblingSessions();
  writeSessionBat();
  await prepareClaudeEnvironment();

  if (state.pid && isPidAlive(state.pid)) {
    state.enabled = true;
    saveState();
    return getStatusPayload();
  }

  const claudePath = await findClaudeOnPath();
  if (!claudePath) {
    throw new Error('claude not found in PATH (npm install -g @anthropic-ai/claude-code)');
  }
  let pid;
  if (!isWindows) {
    pid = await launchMacSession(__dirname);
  } else {
  if (!fs.existsSync(SESSION_BAT)) {
    throw new Error('session.bat missing next to Claude session worker');
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
  pid = Number(String(stdout).trim().split(/\r?\n/).filter(Boolean).pop());
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('Failed to start Claude session window');
  }

  }

  state.enabled = true;
  state.pid = pid;
  state.startedAt = Date.now();
  state.lastError = null;
  saveState();
  log(`Claude session started pid=${pid} model=${config.sessionModel}`);
  return getStatusPayload();
}

async function stopSession() {
  state.lastActionAt = Date.now();
  const pid = state.pid;
  if (pid && isPidAlive(pid)) {
    try {
      await stopAgentProcess(pid);
      log(`Claude session stopped pid=${pid}`);
    } catch (err) {
      log(`taskkill pid=${pid}: ${err.message}`);
    }
  }
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
    if (!isClaudeModelId(value)) {
      throw new Error('sessionModel must be a claude-* model id');
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
  if (state.enabled || (state.pid && isPidAlive(state.pid))) {
    await prepareClaudeEnvironment();
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

  const claudePath = await findClaudeOnPath();
  const credentialsPath = findClaudeCredentials();
  const claudeModels = FALLBACK_CLAUDE_MODELS.includes(config.sessionModel)
    ? FALLBACK_CLAUDE_MODELS
    : [config.sessionModel, ...FALLBACK_CLAUDE_MODELS];

  return {
    ok: true,
    enabled: Boolean(state.enabled && running),
    running,
    pid: running ? state.pid : null,
    startedAt: running ? state.startedAt : null,
    lastError: state.lastError,
    lastActionAt: state.lastActionAt,
    claudeAvailable: Boolean(claudePath),
    claudePath,
    platform: process.platform,
    hasLogin: Boolean(credentialsPath),
    loginPath: credentialsPath,
    hasSessionModel: isClaudeModelId(config.sessionModel),
    sessionModel: config.sessionModel,
    sessionEffort: config.sessionEffort,
    claudeModels,
    efforts: EFFORTS,
    bootstrap: lastBootstrap,
    cursorRouting: {
      ok: Boolean(lastCursorRouting.ok),
      restored: Boolean(lastCursorRouting.restored),
      error: lastCursorRouting.error || null,
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

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log(`request error: ${err.message}`);
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
});

writeSessionBat();
restartHeartbeatTimers();
server.listen(config.listenPort, config.listenHost, () => {
  log(`Claude session worker listening on http://${config.listenHost}:${config.listenPort}`);
});
