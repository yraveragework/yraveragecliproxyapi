import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorSettingsPath, proxyName, sessionEnvironment, terminalCommand } from '../tools/platform.mjs';
test('macOS paths and executable do not use Windows directories', () => {
 assert.equal(proxyName('darwin'), 'cli-proxy-api');
 assert.equal(proxyName('win32'), 'cli-proxy-api.exe');
 assert.equal(cursorSettingsPath('/Users/Test User', 'darwin'), '/Users/Test User/Library/Application Support/Cursor/User/settings.json');
});
test('direct Claude clears inherited routing while preserving other environment', () => {
 const env=sessionEnvironment({sessionModel:'claude-test'}, '/tmp/app', true, {PATH:'/bin',ANTHROPIC_BASE_URL:'private',ANTHROPIC_AUTH_TOKEN:'private',ANTHROPIC_API_KEY:'private',MODEL_ROUTER_KEY:'private',HTTPS_PROXY:'private'});
 assert.equal(env.PATH,'/bin');
 for (const k of ['ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','MODEL_ROUTER_KEY','HTTPS_PROXY']) assert.equal(env[k],undefined);
});
test('routed environment uses configuration, not baked-in credentials', () => {
 const env=sessionEnvironment({cpaBaseUrl:'http://127.0.0.1:8317',apiKey:'test-only',workerModel:'kimi-test',workerEffort:'high'},'/tmp/app',false,{});
 assert.equal(env.ANTHROPIC_AUTH_TOKEN,'test-only');assert.equal(env.MODEL_ROUTER_MODEL,'kimi-test');
});
test('Terminal command quotes paths and contains no configuration secrets', () => {
 const command=terminalCommand('/node path/node',"/app's folder/tools/runner.mjs",'/app path/worker','token',123);
 assert.ok(command.startsWith('exec '));assert.ok(command.includes("'\"'\"'"));assert.ok(!command.includes('apiKey'));
});
