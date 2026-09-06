import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceDefinitions } from '../tools/macos-services.mjs';

test('Mac supervisor honors configured ports and starts only HTTP helpers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac services '));
  try {
    fs.writeFileSync(path.join(root, 'config.yaml'), 'port: 18317\n');
    const folders = ['claude-autostart', 'claude-fabsol-worker', 'local-settings', 'moonshot-worker', 'claude-fabkim-worker', 'claude-session-worker'];
    for (let i = 0; i < folders.length; i++) {
      fs.mkdirSync(path.join(root, folders[i]));
      fs.writeFileSync(path.join(root, folders[i], 'config.json'), JSON.stringify({ listenPort: 20000 + i }));
    }
    const services = serviceDefinitions(root);
    assert.equal(services.length, 7);
    assert.equal(services[0].port, 18317);
    assert.equal(services[0].executable, path.join(root, 'cli-proxy-api'));
    assert.deepEqual(services.slice(1).map((s) => s.port), [20000,20001,20002,20003,20004,20005]);
    assert.ok(services.slice(1).every((s) => s.args.length === 1 && s.args[0].endsWith('worker.mjs')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
