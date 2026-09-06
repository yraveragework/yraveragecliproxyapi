import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
export const isWindows = process.platform === 'win32';
export function proxyName(platform = process.platform) {
  return platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api';
}
export function cursorSettingsPath(home, platform = process.platform) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const base = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? process.env.APPDATA || join(home, 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || join(home, '.config');
  return join(base, 'Cursor', 'User', 'settings.json');
}
export async function findClaude() {
  if (isWindows) {
    try { return (await exec('where.exe', ['claude'], { windowsHide: true })).stdout.trim().split(/\r?\n/)[0] || null; }
    catch { return null; }
  }
  for (const dir of [...(process.env.PATH || '').split(path.delimiter), path.join(process.env.HOME || '', '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']) {
    const file = path.join(dir, 'claude');
    try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}
export function sessionEnvironment(config, root, direct, inherited = process.env) {
  const env = { ...inherited, CLIPROXY_DIR: root };
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy)$/i.test(key) || key.startsWith('MODEL_ROUTER_') ||
        ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'].includes(key)) delete env[key];
  }
  if (!direct) Object.assign(env, {
    ANTHROPIC_BASE_URL: config.cpaBaseUrl,
    ANTHROPIC_AUTH_TOKEN: config.apiKey,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    MODEL_ROUTER_URL: config.cpaBaseUrl,
    MODEL_ROUTER_KEY: config.apiKey,
    MODEL_ROUTER_MODEL: config.workerModel || config.sessionModel,
    MODEL_ROUTER_EFFORT: config.workerEffort || config.sessionEffort || 'high',
  });
  return env;
}
export const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
export function terminalCommand(node, runner, directory, token, deadline) {
  return 'exec ' + [node, runner, directory, token, deadline].map(shellQuote).join(' ');
}
export async function launchMacSession(directory) {
  if (process.platform !== 'darwin') throw new Error('Native Terminal sessions require macOS');
  const token = randomUUID();
  const runtime = path.join(directory, '.runtime');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const receipt = path.join(runtime, token + '.json');
  const deadline = Date.now() + 45000;
  const command = terminalCommand(process.execPath, path.resolve(directory, '../tools/macos-session.mjs'), directory, token, deadline);
  // AppleScript receives only paths and a launch nonce. Credentials stay in local files.
  const script = 'on run argv\ntell application "Terminal"\nactivate\ndo script (item 1 of argv)\nend tell\nend run';
  try {
    await exec('/usr/bin/osascript', ['-e', script, command], { timeout: 45000 });
    while (Date.now() < deadline) {
      try {
        const data = JSON.parse(fs.readFileSync(receipt, 'utf8'));
        if (data.error) throw new Error(data.error);
        if (Number.isInteger(data.pid) && data.pid > 1) return data.pid;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Terminal did not start the session. Check macOS Automation permission and Claude installation.');
  } finally {
    // A delayed Terminal command must not start after the caller timed out.
    fs.writeFileSync(path.join(runtime, token + '.closed'), '', { mode: 0o600 });
    try { fs.unlinkSync(receipt); } catch {}
  }
}
export async function stopAgentProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  if (isWindows) return exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=']);
  const rows = stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = [pid];
  for (let i = 0; i < descendants.length; i++) {
    for (const [child, parent] of rows) if (parent === descendants[i] && !descendants.includes(child)) descendants.push(child);
  }
  // Keep the agent in Terminal's foreground process group so interactive TTY reads work.
  // Stop only this agent's process tree, never the whole Terminal application.
  for (const child of descendants.reverse()) {
    try { process.kill(child, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
  for (const child of descendants) {
    try { process.kill(child, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
