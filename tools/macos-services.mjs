import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), '..');
const runtime = path.join(root, '.runtime');
const stateFile = path.join(runtime, 'services.json');
const folders = ['claude-autostart', 'claude-fabsol-worker', 'local-settings', 'moonshot-worker', 'claude-fabkim-worker', 'claude-session-worker'];
const defaults = [19888, 19889, 19890, 19891, 19892, 19893];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readState() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } }
function saveState(state) { fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); }
async function ownedProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.includes(filename) && stdout.includes('--daemon');
  } catch { return false; }
}
export function serviceDefinitions(directory) {
  const yaml = fs.readFileSync(path.join(directory, 'config.yaml'), 'utf8');
  const port = Number(yaml.match(/^port:\s*(\d+)/m)?.[1] || 8317);
  return [{ name: 'proxy', port, executable: path.join(directory, 'cli-proxy-api'), args: ['--config', path.join(directory, 'config.yaml')], cwd: directory },
    ...folders.map((folder, index) => {
      const config = JSON.parse(fs.readFileSync(path.join(directory, folder, 'config.json'), 'utf8'));
      return { name: folder, port: Number(config.listenPort || defaults[index]), executable: process.execPath,
        args: [path.join(directory, folder, 'worker.mjs')], cwd: directory };
    })];
}
async function portBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
async function daemon() {
  const lock = path.join(runtime, 'services.lock');
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error('Another start is in progress, or services.lock needs review after an unclean shutdown.'); }
  const children = [];
  let closing = false;
  let definitions = [];
  async function shutdown(error) {
    if (closing) return;
    closing = true;
    // Disable sessions through their owning companions before stopping helpers.
    await Promise.all(definitions.filter((s) => /fabsol|fabkim|session|moonshot/.test(s.name)).map(async (service) => {
      if (!children.some((entry) => entry.name === service.name)) return;
      try { await fetch(`http://127.0.0.1:${service.port}/enabled`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":false}', signal: AbortSignal.timeout(5000),
      }); } catch {}
    }));
    for (const { child } of children) { try { child.kill('SIGTERM'); } catch {} }
    await sleep(1000);
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch {} }
    saveState({ status: error ? 'error' : 'stopped', error: error?.message });
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
    process.exit(error ? 1 : 0);
  }
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  try {
    saveState({ pid: process.pid, status: 'starting' });
    definitions = serviceDefinitions(root);
    if (new Set(definitions.map((s) => s.port)).size !== definitions.length) throw new Error('Companion ports must be unique.');
    for (const service of definitions) {
      if (await portBusy(service.port)) throw new Error(`Port ${service.port} is already in use. Stop that installation first.`);
    }
    for (const service of definitions) {
      const fd = fs.openSync(path.join(root, 'logs', service.name + '.log'), 'a', 0o600);
      const child = spawn(service.executable, service.args, { cwd: service.cwd, stdio: ['ignore', fd, fd], env: { ...process.env, CLIPROXY_DIR: root } });
      fs.closeSync(fd);
      children.push({ name: service.name, child });
      child.once('error', () => void shutdown(new Error(`${service.name} failed to launch. Check logs/${service.name}.log.`)));
      child.once('exit', () => { if (!closing) void shutdown(new Error(`${service.name} exited. Check logs/${service.name}.log.`)); });
    }
    const deadline = Date.now() + 30000;
    while (!closing && Date.now() < deadline) {
      if ((await Promise.all(definitions.map((s) => portBusy(s.port)))).every(Boolean)) {
        saveState({ pid: process.pid, status: 'ready', panel: `http://127.0.0.1:${definitions[0].port}/management.html` });
        return;
      }
      await sleep(200);
    }
    if (!closing) throw new Error('Startup timed out. Check logs for the service that failed.');
  } catch (error) { await shutdown(error); }
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('Use start.bat / stop.bat on Windows. These launchers are for macOS.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true, mode: 0o700 });
  const action = process.argv[2] || 'start';
  if (action === '--daemon') return daemon();
  const state = readState();
  const running = await ownedProcess(state?.pid);
  if (action === 'status') { console.log(running ? state.status : 'stopped'); return; }
  if (action === 'stop') {
    if (!running) { console.log('This installation is not running.'); return; }
    process.kill(state.pid, 'SIGTERM');
    for (let i = 0; i < 100; i++) { if (!(await ownedProcess(state.pid))) { console.log('Stopped this installation.'); return; } await sleep(100); }
    throw new Error('Shutdown is still in progress. Check logs before retrying.');
  }
  if (action !== 'start') throw new Error('Usage: start | stop | status');
  if (!running) {
    fs.accessSync(path.join(root, 'cli-proxy-api'), fs.constants.X_OK);
    serviceDefinitions(root); // Validate configuration before launching background work.
    const fd = fs.openSync(path.join(root, 'logs', 'launcher.log'), 'a', 0o600);
    const child = spawn(process.execPath, [filename, '--daemon'], { cwd: root, detached: true, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    child.unref();
    await sleep(200);
    for (let i = 0; i < 160; i++) {
      const current = readState();
      if (current?.pid === child.pid && current.status === 'ready') break;
      if (current?.status === 'error') throw new Error(current.error);
      if (i === 159) throw new Error('Startup did not finish. Check logs/launcher.log (including any stale lock).');
      await sleep(200);
    }
  }
  const ready = readState();
  if (ready?.status !== 'ready') throw new Error('Startup is already in progress. Try again shortly.');
  console.log(`Running: ${ready.panel}\nAgent sessions stay off until enabled in the panel.`);
  let openPanel = true;
  try { openPanel = JSON.parse(fs.readFileSync(path.join(root, 'app-settings.json'), 'utf8')).openPanelOnStart !== false; } catch {}
  if (openPanel && process.env.CLIPROXY_NO_BROWSER !== '1') await exec('/usr/bin/open', [ready.panel]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === filename) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
