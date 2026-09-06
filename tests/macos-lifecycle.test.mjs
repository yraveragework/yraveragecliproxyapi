import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
test('macOS start is idempotent and stop closes only its seven services', { skip: process.platform !== 'darwin', timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "CLI Proxy's test "));
  const filename = path.join(root, 'tools', 'macos-services.mjs');
  const ports = [];
  const unrelated = net.createServer();
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  const run = (action) => exec(process.execPath, [filename, action], { env: { ...process.env, CLIPROXY_NO_BROWSER: '1' }, timeout: 40000 });
  try {
    fs.mkdirSync(path.dirname(filename));
    fs.copyFileSync(new URL('../tools/macos-services.mjs', import.meta.url), filename);
    while (ports.length < 7) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
    fs.writeFileSync(path.join(root, 'config.yaml'), `port: ${ports[0]}\n`);
    fs.writeFileSync(path.join(root, 'cli-proxy-api'), `#!/usr/bin/env node\nrequire('http').createServer((q,s)=>s.end('ok')).listen(${ports[0]},'127.0.0.1');\n`, { mode: 0o700 });
    const folders = ['claude-autostart', 'claude-fabsol-worker', 'local-settings', 'moonshot-worker', 'claude-fabkim-worker', 'claude-session-worker'];
    for (let i = 0; i < folders.length; i++) {
      fs.mkdirSync(path.join(root, folders[i]));
      fs.writeFileSync(path.join(root, folders[i], 'config.json'), JSON.stringify({ listenPort: ports[i + 1] }));
      fs.writeFileSync(path.join(root, folders[i], 'worker.mjs'), `import http from 'node:http';http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end('{"enabled":false}');}).listen(${ports[i + 1]},'127.0.0.1');`);
    }
    await run('start');
    const first = JSON.parse(fs.readFileSync(path.join(root, '.runtime/services.json')));
    assert.equal(first.status, 'ready');
    await run('start');
    const second = JSON.parse(fs.readFileSync(path.join(root, '.runtime/services.json')));
    assert.equal(second.pid, first.pid);
    for (const port of ports.slice(1)) assert.equal((await (await fetch(`http://127.0.0.1:${port}/status`)).json()).enabled, false);
    await run('stop');
    assert.match((await run('status')).stdout, /stopped/);
    for (const port of ports) await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));
    assert.ok(unrelated.listening);
  } finally {
    try { await run('stop'); } catch {}
    await new Promise((resolve) => unrelated.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
