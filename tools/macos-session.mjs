// Runs inside Terminal, only after a browser feature is enabled.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findClaude, sessionEnvironment, stopAgentProcess } from './platform.mjs';

const [directory, token, deadline] = process.argv.slice(2);
if (process.platform !== 'darwin' || !directory || !/^[a-f0-9-]{36}$/.test(token || '')) process.exit(1);
const runtime = path.join(directory, '.runtime');
const receipt = path.join(runtime, token + '.json');
const closed = path.join(runtime, token + '.closed');
if (Date.now() > Number(deadline) || fs.existsSync(closed)) process.exit(1);
try {
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
  const root = path.resolve(directory, '..');
  const direct = path.basename(directory) === 'claude-session-worker';
  const executable = await findClaude();
  if (!executable) throw new Error('Claude Code is not on PATH. Install and log in before enabling this feature.');
  const model = config.orchestratorModel || config.sessionModel;
  if (!model || (!direct && (!config.apiKey || !config.cpaBaseUrl))) throw new Error('Configure the model and proxy credentials in this companion config.json first.');
  const child = spawn(executable, ['--model', model], {
    cwd: root, env: sessionEnvironment(config, root, direct), stdio: 'inherit',
  });
  child.once('error', (error) => {
    fs.writeFileSync(receipt, JSON.stringify({ error: error.message }), { mode: 0o600 });
    process.exitCode = 1;
  });
  child.once('spawn', () => {
    fs.writeFileSync(receipt, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
  });
  // Closing Terminal should stop the agent and all its subprocesses.
  for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, async () => {
    await stopAgentProcess(child.pid); process.exit(0);
  });
  child.once('exit', (code) => {
    try { fs.unlinkSync(receipt); } catch {}
    try { fs.unlinkSync(closed); } catch {}
    process.exitCode = code || 0;
  });
} catch (error) {
  fs.writeFileSync(receipt, JSON.stringify({ error: error.message }), { mode: 0o600 });
  console.error(error.message);
  process.exitCode = 1;
}
