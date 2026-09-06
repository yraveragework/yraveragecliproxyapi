import { isWindows, proxyName, cursorSettingsPath, findClaude, launchMacSession, stopAgentProcess } from '../tools/platform.mjs';
/**
 * FabKim companion worker for CLI Proxy API management panel.
 * Starts / stops a Claude Code FabKim session and reports status.
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
const PROXY_EXE = path.join(ROOT, proxyName());
const PROXY_CONFIG = path.join(ROOT, 'config.yaml');
const MODEL_ROUTER_SRC = path.join(ROOT, 'model-router');
const CLAUDE_HOME = path.join(HOME, '.claude');
const CURSOR_SKILLS = path.join(HOME, '.cursor', 'skills');
const CURSOR_SETTINGS = cursorSettingsPath(HOME);

/** Other Operate session companions — only one mode should own MODEL_ROUTER_* / Cursor at a time. */
const SIBLING_SESSION_PORTS = [19889, 19891, 19892, 19893];

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_ORCHESTRATORS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];
const FALLBACK_KIMI_WORKERS = [
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
  listenPort: 19892,
  cpaBaseUrl: 'http://127.0.0.1:8317',
  apiKey: 'CHANGE_ME_LOCAL_SECRET',
  orchestratorModel: 'claude-fable-5',
  orchestratorEffort: 'high',
  workerModel: 'kimi-k3',
  workerEffort: 'high',
  /** Local HTTP probe interval (seconds). 0 = off. Uses 0 model tokens. */
  heartbeatSeconds: 15,
  /** Optional tiny model ping (1–5 tokens). Off by default. */
  tokenPingEnabled: false,
  /** Token ping interval (seconds). Only used when tokenPingEnabled. */
  tokenPingSeconds: 300,
};

function isKimiModelId(id) {
  const value = String(id || '').trim().toLowerCase();
  return value.startsWith('kimi-') || value.startsWith('moonshot-');
}

function isClaudeModelId(id) {
  const value = String(id || '').trim().toLowerCase();
  return value.startsWith('claude-');
}

/** @type {{ skills: boolean, settings: boolean, userEnv: boolean, cursorEnv: boolean, notes: string[] }} */
let lastBootstrap = {
  skills: false,
  settings: false,
  userEnv: false,
  cursorEnv: false,
  notes: [],
};

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
  return {
    listenHost: String(loaded.listenHost || DEFAULT_CONFIG.listenHost),
    listenPort: Number(loaded.listenPort) || DEFAULT_CONFIG.listenPort,
    cpaBaseUrl: String(loaded.cpaBaseUrl || DEFAULT_CONFIG.cpaBaseUrl).replace(/\/+$/, ''),
    apiKey: String(loaded.apiKey || DEFAULT_CONFIG.apiKey),
    orchestratorModel: String(loaded.orchestratorModel || DEFAULT_CONFIG.orchestratorModel).trim(),
    orchestratorEffort: normalizeEffort(loaded.orchestratorEffort, DEFAULT_CONFIG.orchestratorEffort),
    workerModel: String(loaded.workerModel || DEFAULT_CONFIG.workerModel).trim(),
    workerEffort: normalizeEffort(loaded.workerEffort, DEFAULT_CONFIG.workerEffort),
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

/** Stop FabSol / Moonshot (etc.) so FabKim owns the session env exclusively. */
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
        log(`sibling session on :${port} stopped for FabKim`);
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
      return { ok: false, models: [], error: `HTTP ${response.status}` };
    }
    const body = await response.json();
    const ids = Array.isArray(body?.data) ? body.data.map((m) => m.id).filter(Boolean) : [];
    return {
      ok: true,
      models: ids,
      hasOrchestrator: ids.includes(config.orchestratorModel),
      hasWorker: ids.includes(config.workerModel),
      error: null,
    };
  } catch (err) {
    return { ok: false, models: [], error: err.message || String(err) };
  }
}

/** Local HTTP probe — 0 model tokens. Updates andon heartbeat state. */
async function runHeartbeatProbe() {
  const proxy = await probeProxy();
  heartbeat.lastAt = Date.now();
  heartbeat.ok = Boolean(proxy.ok && proxy.hasWorker);
  heartbeat.lastError = proxy.ok
    ? proxy.hasWorker
      ? null
      : `worker model missing: ${config.workerModel}`
    : proxy.error || 'proxy unreachable';
  return proxy;
}

/**
 * Tiny completion against the worker model (target 1–5 tokens).
 * Used only when tokenPingEnabled — default off.
 */
async function runTokenPing() {
  const payload = {
    model: config.workerModel,
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

/** Regenerate session.bat so the launcher matches the current config. */
function writeSessionBat() {
  if (!isWindows) return;
  const bat = `@echo off
REM Session launcher used by the FabKim management worker.
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
set MODEL_ROUTER_MODEL=${config.workerModel}
set MODEL_ROUTER_EFFORT=${config.workerEffort}
set CLIPROXY_DIR=%cd%

where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] claude not found in PATH.
  echo Install with: npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

title ClaudeFabKim
echo FabKim session ready via proxy :8317
echo   Orchestrator: ${config.orchestratorModel} @ ${config.orchestratorEffort}
echo   Worker:       ${config.workerModel} @ ${config.workerEffort}
echo   Command:      /fabkim ^<brief^>
echo.
claude --model ${config.orchestratorModel} %*
endlocal
`;
  fs.writeFileSync(SESSION_BAT, bat.replace(/\n/g, '\r\n'), 'utf8');
}

async function findClaudeOnPath() { return findClaude(); }

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
    MODEL_ROUTER_MODEL: config.workerModel,
    MODEL_ROUTER_EFFORT: config.workerEffort,
    CLIPROXY_DIR: ROOT,
  };
}

/** Install skills/commands/agents/scripts into ~/.claude so /fabkim works in Claude Desktop + Cursor. */
function ensureClaudeManualInstall() {
  const notes = [];
  if (!fs.existsSync(MODEL_ROUTER_SRC)) {
    notes.push('model-router folder missing next to cli-proxy-api.exe');
    return { ok: false, notes };
  }

  ensureDir(CLAUDE_HOME);
  const pairs = [
    [path.join(MODEL_ROUTER_SRC, 'skills', 'fabkim'), path.join(CLAUDE_HOME, 'skills', 'fabkim')],
    [path.join(MODEL_ROUTER_SRC, 'skills', 'fabkim'), path.join(CURSOR_SKILLS, 'fabkim')],
    [path.join(MODEL_ROUTER_SRC, 'skills', 'model-router'), path.join(CLAUDE_HOME, 'skills', 'model-router')],
    [path.join(MODEL_ROUTER_SRC, 'commands'), path.join(CLAUDE_HOME, 'commands')],
    [path.join(MODEL_ROUTER_SRC, 'agents'), path.join(CLAUDE_HOME, 'agents')],
    [path.join(MODEL_ROUTER_SRC, 'scripts'), path.join(CLAUDE_HOME, 'skills', 'model-router', 'scripts')],
  ];

  for (const [src, dest] of pairs) {
    if (!fs.existsSync(src)) {
      notes.push(`missing source: ${path.relative(ROOT, src)}`);
      continue;
    }
    copyDirRecursive(src, dest);
  }

  // Point start-proxy at this install; keep api key / effort matching this machine.
  const fabkimSkill = path.join(CLAUDE_HOME, 'skills', 'fabkim', 'SKILL.md');
  if (fs.existsSync(fabkimSkill)) {
    let text = fs.readFileSync(fabkimSkill, 'utf8');
    text = text
      .replaceAll('my-proxy-key', config.apiKey)
      .replace(/\| Worker model \| `MODEL_ROUTER_MODEL` \| `[^`]+` \|/g, `| Worker model | \`MODEL_ROUTER_MODEL\` | \`${config.workerModel}\` |`)
      .replace(/\| Worker effort \| `MODEL_ROUTER_EFFORT` \| `low` \|/g, `| Worker effort | \`MODEL_ROUTER_EFFORT\` | \`${config.workerEffort}\` |`)
      .replace(/\$\{MODEL_ROUTER_MODEL:-kimi-k3\}/g, `\${MODEL_ROUTER_MODEL:-${config.workerModel}}`)
      .replace(/\$\{MODEL_ROUTER_EFFORT:-low\}/g, `\${MODEL_ROUTER_EFFORT:-${config.workerEffort}}`)
      .replace(/\$\{MODEL_ROUTER_EFFORT:-high\}/g, `\${MODEL_ROUTER_EFFORT:-${config.workerEffort}}`);

    // Windows: PowerShell aliases curl → Invoke-WebRequest, which breaks -H/-s flags
    // and makes FabKim preflight look "empty". Force curl.exe in the skill text.
    if (isWindows && !text.includes('curl.exe')) {
      text = text.replace(
        /```bash\ncurl -s "\$\{MODEL_ROUTER_URL:-[^"]+\}\/v1\/models" \\\n\s*-H "Authorization: Bearer \$\{MODEL_ROUTER_KEY:-[^"]+\}"\n```/m,
        `\`\`\`powershell
# Windows: use curl.exe (plain \`curl\` is a PowerShell alias and returns empty/errors)
curl.exe -s "$env:MODEL_ROUTER_URL/v1/models" -H "Authorization: Bearer $env:MODEL_ROUTER_KEY"
# Git Bash / macOS / Linux:
# curl.exe -s "\${MODEL_ROUTER_URL:-http://127.0.0.1:8317}/v1/models" -H "Authorization: Bearer \${MODEL_ROUTER_KEY:-${config.apiKey}}"
\`\`\``
      );
    }

    if (!text.includes('Desktop Commander')) {
      text += `

## Windows / Claude Desktop note

If a sandboxed Bash call cannot reach \`127.0.0.1:8317\`, re-run the same
\`curl\` / \`claude -p\` check via Desktop Commander (or any host-side shell MCP).
\`.claude/settings.json\` excludes \`curl\` and \`claude\` from the sandbox when
FabKim is enabled from the management panel.
`;
    }
    fs.writeFileSync(fabkimSkill, text, 'utf8');
  }

  notes.push(`fabkim skills/commands synced into ${CLAUDE_HOME} and ${CURSOR_SKILLS}`);
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
  // Never force the main session through the proxy — only MODEL_ROUTER_* for workers.
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
  if (!isWindows) return { ok: true, notes: ['Routing environment is applied only to the requested macOS session.'] };
  const env = routerEnv();
  const notes = [];
  const tmpPs1 = path.join(__dirname, 'set-user-env.ps1');
  const lines = Object.entries(env).map(([name, value]) => {
    const current = process.env[name];
    // Always write User scope; skip only if already exact.
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
    const key = isWindows ? 'terminal.integrated.env.windows' : 'terminal.integrated.env.osx';
    current[key] = { ...(current[key] || {}), ...env };
    fs.writeFileSync(CURSOR_SETTINGS, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    notes.push(`Cursor terminal env updated (${CURSOR_SETTINGS})`);
    return { ok: true, notes };
  } catch (err) {
    notes.push(`Cursor settings skip: ${err.message}`);
    return { ok: false, notes };
  }
}

async function prepareFabKimEnvironment() {
  const notes = [];
  const skills = ensureClaudeManualInstall();
  const settings = ensureClaudeSettings();
  const userEnv = await ensureUserEnvVars();
  const cursorEnv = ensureCursorTerminalEnv();
  notes.push(...skills.notes, ...settings.notes, ...userEnv.notes, ...cursorEnv.notes);
  lastBootstrap = {
    skills: skills.ok,
    settings: settings.ok,
    userEnv: userEnv.ok,
    cursorEnv: cursorEnv.ok,
    notes,
  };
  for (const note of notes) log(`bootstrap: ${note}`);
  return lastBootstrap;
}

async function startSession() {
  state.lastActionAt = Date.now();
  state.lastError = null;

  await ensureProxyRunning();
  // Moonshot (Kimi-only Cursor override) and FabSol must yield — FabKim is Claude orchestrator + Kimi worker.
  await stopSiblingSessions();
  writeSessionBat();
  await prepareFabKimEnvironment();

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
    throw new Error('session.bat missing next to FabKim worker');
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
    throw new Error('Failed to start FabKim session window');
  }

  }

  state.enabled = true;
  state.pid = pid;
  state.startedAt = Date.now();
  state.lastError = null;
  saveState();
  log(`FabKim session started pid=${pid}`);
  return getStatusPayload();
}

async function stopSession() {
  state.lastActionAt = Date.now();
  const pid = state.pid;
  if (pid && isPidAlive(pid)) {
    try {
      await stopAgentProcess(pid);
      log(`FabKim session stopped pid=${pid}`);
    } catch (err) {
      // process may already be gone
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
  if (body.orchestratorModel != null) {
    const value = String(body.orchestratorModel).trim();
    if (!value) throw new Error('orchestratorModel is required');
    if (!isClaudeModelId(value)) {
      throw new Error('orchestratorModel must be a claude-* model id');
    }
    next.orchestratorModel = value;
  }
  if (body.orchestratorEffort != null) {
    next.orchestratorEffort = normalizeEffort(body.orchestratorEffort, config.orchestratorEffort);
  }
  if (body.workerModel != null) {
    const value = String(body.workerModel).trim();
    if (!value) throw new Error('workerModel is required');
    if (!isKimiModelId(value)) {
      throw new Error('workerModel must be a kimi-* (or moonshot-*) model id');
    }
    next.workerModel = value;
  }
  if (body.workerEffort != null) {
    next.workerEffort = normalizeEffort(body.workerEffort, config.workerEffort);
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
  await prepareFabKimEnvironment();
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
  const proxyClaude = (proxy.models || []).filter(isClaudeModelId);
  const proxyKimi = (proxy.models || []).filter(isKimiModelId);
  const orchestratorModels =
    proxyClaude.length > 0
      ? Array.from(new Set([config.orchestratorModel, ...proxyClaude, ...FALLBACK_ORCHESTRATORS]))
      : FALLBACK_ORCHESTRATORS.includes(config.orchestratorModel)
        ? FALLBACK_ORCHESTRATORS
        : [config.orchestratorModel, ...FALLBACK_ORCHESTRATORS];
  const workerModels =
    proxyKimi.length > 0
      ? Array.from(new Set([config.workerModel, ...proxyKimi]))
      : FALLBACK_KIMI_WORKERS.includes(config.workerModel)
        ? FALLBACK_KIMI_WORKERS
        : [config.workerModel, ...FALLBACK_KIMI_WORKERS];

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
    hasOrchestratorModel: Boolean(proxy.hasOrchestrator) || isClaudeModelId(config.orchestratorModel),
    hasWorkerModel: Boolean(proxy.hasWorker),
    orchestratorModel: config.orchestratorModel,
    orchestratorEffort: config.orchestratorEffort,
    workerModel: config.workerModel,
    workerEffort: config.workerEffort,
    orchestratorModels,
    workerModels,
    efforts: EFFORTS,
    cpaBaseUrl: config.cpaBaseUrl,
    claudeAvailable: Boolean(claudePath),
    claudePath,
    bootstrap: lastBootstrap,
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
  log(`FabKim worker listening on http://${config.listenHost}:${config.listenPort}`);
});
