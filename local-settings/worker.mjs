import { isWindows, cursorSettingsPath, proxyName } from '../tools/platform.mjs';
/**
 * Local settings companion for CLI Proxy API.
 * Path healing, Windows login autostart, auth-dir modes, app QoL settings.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const APP_SETTINGS_PATH = path.join(ROOT, 'app-settings.json');
const PROXY_CONFIG_PATH = path.join(ROOT, 'config.yaml');
const LOG_PATH = path.join(__dirname, 'worker.log');
const START_BAT = path.join(ROOT, 'start.bat');
const FIXED_AUTH_DIR = isWindows ? 'C:\\cli-proxy-api' : path.join(HOME, '.cli-proxy-api');
const STARTUP_LINK_NAME = 'CLIProxyAPI.lnk';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/router-for-me/CLIProxyAPI/releases';
const UPDATE_ROOT = path.join(ROOT, '_updates');
const PROXY_EXE_NAME = proxyName();
const PROXY_EXE_PATH = path.join(ROOT, PROXY_EXE_NAME);
const MIN_UPDATE_EXE_BYTES = 1024 * 1024;
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'CLIProxyAPI-local-settings-updater',
  'X-GitHub-Api-Version': '2022-11-28',
};
let updateApplyBusy = false;

const DEFAULT_SETTINGS = {
  windowsLoginEnabled: false,
  openPanelOnStart: true,
  startMinimized: true,
  authMode: isWindows ? 'fixed' : 'portable',
  authCustomPath: '',
  autoRefreshSeconds: 30,
  notificationsEnabled: true,
  notificationDurationMs: 3000,
  companionPorts: {
    claudeAutostart: 19888,
    fabSol: 19889,
    fabKim: 19892,
    localSettings: 19890,
  },
};

/** @type {{ listenHost: string, listenPort: number }} */
let config = loadWorkerConfig();
/** @type {typeof DEFAULT_SETTINGS} */
let settings = loadAppSettings();

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

function loadWorkerConfig() {
  const fallback = { listenHost: '127.0.0.1', listenPort: 19890 };
  const loaded = readJson(CONFIG_PATH, fallback);
  return {
    listenHost: String(loaded.listenHost || fallback.listenHost),
    listenPort: Number(loaded.listenPort) || fallback.listenPort,
  };
}

function normalizeSettings(input) {
  const next = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(input && typeof input === 'object' ? input : {}),
  };
  next.windowsLoginEnabled = Boolean(next.windowsLoginEnabled);
  next.openPanelOnStart = next.openPanelOnStart !== false;
  next.startMinimized = next.startMinimized !== false;
  const mode = String(next.authMode || 'fixed').toLowerCase();
  next.authMode = ['fixed', 'portable', 'custom'].includes(mode) ? mode : 'fixed';
  next.authCustomPath = String(next.authCustomPath || '').trim();
  next.autoRefreshSeconds = Math.min(
    600,
    Math.max(0, Number(next.autoRefreshSeconds) || 0)
  );
  next.notificationsEnabled = next.notificationsEnabled !== false;
  next.notificationDurationMs = Math.min(
    30000,
    Math.max(1000, Number(next.notificationDurationMs) || DEFAULT_SETTINGS.notificationDurationMs)
  );
  const ports = next.companionPorts && typeof next.companionPorts === 'object'
    ? next.companionPorts
    : {};
  next.companionPorts = {
    claudeAutostart: Number(ports.claudeAutostart) || 19888,
    fabSol: Number(ports.fabSol) || 19889,
    fabKim: Number(ports.fabKim) || 19892,
    localSettings: Number(ports.localSettings) || 19890,
  };
  return next;
}

function loadAppSettings() {
  return normalizeSettings(readJson(APP_SETTINGS_PATH, DEFAULT_SETTINGS));
}

function saveAppSettings(next) {
  settings = normalizeSettings(next);
  writeJson(APP_SETTINGS_PATH, settings);
  return settings;
}

function portableAuthDir() {
  return path.join(ROOT, 'auth');
}

function resolveAuthPath(mode = settings.authMode, customPath = settings.authCustomPath) {
  if (mode === 'portable') return portableAuthDir();
  if (mode === 'custom') {
    const custom = String(customPath || '').trim();
    if (!custom) return FIXED_AUTH_DIR;
    return path.resolve(custom);
  }
  return FIXED_AUTH_DIR;
}

function readAuthDirFromYaml() {
  try {
    if (!fs.existsSync(PROXY_CONFIG_PATH)) return null;
    const text = fs.readFileSync(PROXY_CONFIG_PATH, 'utf8');
    const match = text.match(/^\s*auth-dir:\s*["']?([^"'#\r\n]+)["']?/m);
    if (!match) return null;
    return match[1].trim().replace(/\//g, path.sep);
  } catch {
    return null;
  }
}

function updateAuthDirInConfig(newAuthDir) {
  const yamlPath = String(newAuthDir).replace(/\\/g, '/');
  let text = fs.existsSync(PROXY_CONFIG_PATH)
    ? fs.readFileSync(PROXY_CONFIG_PATH, 'utf8')
    : '';
  if (/^\s*auth-dir:\s*.+$/m.test(text)) {
    text = text.replace(/^\s*auth-dir:\s*.+$/m, `auth-dir: "${yamlPath}"`);
  } else {
    text = `auth-dir: "${yamlPath}"\n${text}`;
  }
  fs.writeFileSync(PROXY_CONFIG_PATH, text, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return { copied: 0 };
  ensureDir(dest);
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += copyDirRecursive(from, to).copied;
    } else {
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
  return { copied };
}

function removeDirContents(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
    else fs.unlinkSync(full);
  }
}

function getStartupDir() {
  return path.join(
    process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
}

function startupShortcutPath() {
  return path.join(getStartupDir(), STARTUP_LINK_NAME);
}

function isWindowsLoginEnabled() {
  if (!isWindows) return false;
  return fs.existsSync(startupShortcutPath());
}

async function setWindowsLogin(enabled) {
  if (!isWindows) {
    if (enabled) throw new Error('Windows login startup is unavailable on macOS. Use start.command to launch the app.');
    return { ok: true, enabled: false };
  }
  const linkPath = startupShortcutPath();
  if (!enabled) {
    if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    settings = saveAppSettings({ ...settings, windowsLoginEnabled: false });
    return { ok: true, enabled: false, shortcutPath: linkPath };
  }

  if (!fs.existsSync(START_BAT)) {
    throw new Error('start.bat not found in install root');
  }

  ensureDir(getStartupDir());
  const ps = [
    `$w = New-Object -ComObject WScript.Shell`,
    `$s = $w.CreateShortcut('${linkPath.replace(/'/g, "''")}')`,
    `$s.TargetPath = '${START_BAT.replace(/'/g, "''")}'`,
    `$s.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'`,
    `$s.WindowStyle = 7`,
    `$s.Description = 'CLI Proxy API auto-start at login'`,
    `$s.Save()`,
  ].join('; ');

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    ps,
  ]);

  settings = saveAppSettings({ ...settings, windowsLoginEnabled: true });
  return { ok: true, enabled: true, shortcutPath: linkPath };
}

async function healCliproxyDir() {
  if (!isWindows) {
    process.env.CLIPROXY_DIR = ROOT;
    return { ok: true, installRoot: ROOT, notes: ['macOS uses per-session environment; Windows startup shortcuts are not modified.'] };
  }
  const notes = [];
  const name = 'CLIPROXY_DIR';
  const value = ROOT;
  const tmpPs1 = path.join(__dirname, 'heal-env.ps1');
  const script = [
    `$name = '${name}'`,
    `$value = '${value.replace(/'/g, "''")}'`,
    `$existing = [Environment]::GetEnvironmentVariable($name, 'User')`,
    `if ($existing -ne $value) { [Environment]::SetEnvironmentVariable($name, $value, 'User') }`,
    `exit 0`,
  ].join('\n');
  fs.writeFileSync(tmpPs1, `${script}\n`, 'utf8');
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      tmpPs1,
    ]);
    process.env.CLIPROXY_DIR = value;
    notes.push(`CLIPROXY_DIR healed to ${value}`);
  } catch (err) {
    notes.push(`CLIPROXY_DIR heal failed: ${err.message}`);
  } finally {
    try {
      fs.unlinkSync(tmpPs1);
    } catch {
      // ignore
    }
  }

  // Cursor terminal env
  try {
    const cursorSettings = path.join(
      process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'),
      'Cursor',
      'User',
      'settings.json'
    );
    ensureDir(path.dirname(cursorSettings));
    let current = {};
    if (fs.existsSync(cursorSettings)) {
      current = JSON.parse(fs.readFileSync(cursorSettings, 'utf8'));
    }
    const key = 'terminal.integrated.env.windows';
    current[key] = { ...(current[key] || {}), CLIPROXY_DIR: value };
    fs.writeFileSync(cursorSettings, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    notes.push('Cursor terminal CLIPROXY_DIR updated');
  } catch (err) {
    notes.push(`Cursor env skip: ${err.message}`);
  }

  // Heal login shortcut target if enabled
  if (settings.windowsLoginEnabled || isWindowsLoginEnabled()) {
    try {
      await setWindowsLogin(true);
      notes.push('Windows login shortcut refreshed to current start.bat');
    } catch (err) {
      notes.push(`Login shortcut heal failed: ${err.message}`);
    }
  }

  return { ok: true, installRoot: ROOT, notes };
}

function applyCompanionPorts(ports) {
  const next = {
    claudeAutostart: Number(ports?.claudeAutostart) || 19888,
    fabSol: Number(ports?.fabSol) || 19889,
    fabKim: Number(ports?.fabKim) || 19892,
    localSettings: Number(ports?.localSettings) || config.listenPort || 19890,
  };

  const pairs = [
    [path.join(ROOT, 'claude-autostart', 'config.json'), 'claudeAutostart'],
    [path.join(ROOT, 'claude-fabsol-worker', 'config.json'), 'fabSol'],
    [path.join(ROOT, 'claude-fabkim-worker', 'config.json'), 'fabKim'],
    [CONFIG_PATH, 'localSettings'],
  ];

  for (const [filePath, key] of pairs) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data.listenPort = next[key];
      writeJson(filePath, data);
    } catch (err) {
      log(`port write ${filePath}: ${err.message}`);
    }
  }

  return next;
}

async function setAuthLocation({ mode, customPath, moveFiles = true }) {
  const previousPath = resolveAuthPath(settings.authMode, settings.authCustomPath);
  const yamlPath = readAuthDirFromYaml();
  const sourcePath = yamlPath && fs.existsSync(yamlPath) ? yamlPath : previousPath;

  const nextMode = ['fixed', 'portable', 'custom'].includes(String(mode))
    ? String(mode)
    : 'fixed';
  const nextCustom = String(customPath ?? settings.authCustomPath ?? '').trim();
  const targetPath = resolveAuthPath(nextMode, nextCustom);

  ensureDir(targetPath);

  let copied = 0;
  const same =
    path.resolve(sourcePath).toLowerCase() === path.resolve(targetPath).toLowerCase();
  if (moveFiles && !same && fs.existsSync(sourcePath)) {
    copied = copyDirRecursive(sourcePath, targetPath).copied;
    // After successful copy from a previous location, clear source only when leaving fixed/custom
    // and source is not the fixed system path the user may still want — only clear if source was portable or custom and different.
    if (
      path.resolve(sourcePath).toLowerCase() !== path.resolve(FIXED_AUTH_DIR).toLowerCase() &&
      path.resolve(sourcePath).toLowerCase() !== path.resolve(targetPath).toLowerCase()
    ) {
      try {
        removeDirContents(sourcePath);
      } catch {
        // ignore cleanup failures
      }
    }
  }

  updateAuthDirInConfig(targetPath);
  settings = saveAppSettings({
    ...settings,
    authMode: nextMode,
    authCustomPath: nextMode === 'custom' ? nextCustom : settings.authCustomPath,
  });

  return {
    ok: true,
    mode: settings.authMode,
    path: targetPath,
    previousPath: sourcePath,
    filesCopied: copied,
    restartProxyRecommended: true,
  };
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseVersionSegments(value) {
  const normalized = normalizeVersion(value);
  const [core, prerelease = ''] = normalized.split('-', 2);
  const segments = (core.match(/\d+/g) || []).map((part) => Number(part));
  return { segments, prerelease };
}

function compareVersions(left, right) {
  const a = parseVersionSegments(left);
  const b = parseVersionSegments(right);
  const count = Math.max(a.segments.length, b.segments.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (a.segments[index] || 0) - (b.segments[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return a.prerelease.localeCompare(b.prerelease, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function safeUpdateFolderName(tagName) {
  const safe = String(tagName || 'release')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return safe || 'release';
}

function selectReleaseAsset(release) {
  if (!isWindows) throw new Error('On macOS, replace cli-proxy-api from the matching upstream darwin release after stopping the app. The Windows updater is unavailable.');
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const platforms = process.arch === 'arm64'
    ? ['windows_aarch64', 'windows_amd64']
    : ['windows_amd64'];
  for (const platform of platforms) {
    const asset = assets.find((candidate) => {
      const name = String(candidate?.name || '');
      return name.toLowerCase().includes(platform) && name.toLowerCase().endsWith('.zip');
    });
    if (asset) return asset;
  }
  throw new Error(`No compatible Windows release zip found for ${process.arch}`);
}

async function fetchGitHubRelease(tagName = '') {
  const requestedTag = String(tagName || '').trim();
  const endpoint = requestedTag
    ? `${GITHUB_RELEASES_URL}/tags/${encodeURIComponent(requestedTag)}`
    : `${GITHUB_RELEASES_URL}/latest`;
  log(`update: fetching GitHub release ${requestedTag || 'latest'}`);
  const response = await fetch(endpoint, {
    headers: GITHUB_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`GitHub release request failed (${response.status}): ${details}`);
  }
  const release = await response.json();
  const asset = selectReleaseAsset(release);
  log(`update: resolved ${release.tag_name} asset ${asset.name}`);
  return { release, asset };
}

function releasePayload(releaseInfo, current = '') {
  const { release, asset } = releaseInfo;
  const latest = normalizeVersion(release.tag_name || release.name);
  const normalizedCurrent = normalizeVersion(current);
  return {
    ok: true,
    current: normalizedCurrent,
    latest,
    updateAvailable: compareVersions(latest, normalizedCurrent) > 0,
    tagName: release.tag_name || latest,
    name: release.name || release.tag_name || latest,
    body: release.body || '',
    publishedAt: release.published_at || release.created_at || null,
    htmlUrl: release.html_url || null,
    asset: {
      name: asset.name,
      size: Number(asset.size) || 0,
      browser_download_url: asset.browser_download_url,
    },
    installRoot: ROOT,
  };
}

async function downloadReleaseAsset(releaseInfo) {
  const { release, asset } = releaseInfo;
  const tagName = release.tag_name || normalizeVersion(release.name) || 'release';
  const releaseDir = path.join(UPDATE_ROOT, safeUpdateFolderName(tagName));
  const zipPath = path.join(releaseDir, 'asset.zip');
  const tempPath = `${zipPath}.download`;
  ensureDir(releaseDir);

  if (fs.existsSync(zipPath)) {
    const existingSize = fs.statSync(zipPath).size;
    if (existingSize > 0 && (!Number(asset.size) || existingSize === Number(asset.size))) {
      log(`update: using cached ${zipPath} (${existingSize} bytes)`);
      return { ok: true, tagName, zipPath, bytes: existingSize, assetName: asset.name };
    }
    fs.rmSync(zipPath, { force: true });
  }
  fs.rmSync(tempPath, { force: true });

  log(`update: downloading ${asset.name} to ${zipPath}`);
  try {
    const response = await fetch(asset.browser_download_url, {
      headers: {
        'User-Agent': GITHUB_HEADERS['User-Agent'],
        Accept: 'application/octet-stream',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Release download failed (${response.status} ${response.statusText})`);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
    const bytes = fs.statSync(tempPath).size;
    if (bytes <= 0) throw new Error('Downloaded release zip is empty');
    if (Number(asset.size) > 0 && bytes !== Number(asset.size)) {
      throw new Error(`Downloaded size mismatch: expected ${asset.size}, received ${bytes}`);
    }
    fs.renameSync(tempPath, zipPath);
    log(`update: downloaded ${bytes} bytes`);
    return { ok: true, tagName, zipPath, bytes, assetName: asset.name };
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    throw err;
  }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function extractRelease(tagName, zipPath) {
  const releaseDir = path.join(UPDATE_ROOT, safeUpdateFolderName(tagName));
  const extractPath = path.join(releaseDir, 'extract');
  fs.rmSync(extractPath, { recursive: true, force: true });
  ensureDir(extractPath);
  log(`update: extracting ${zipPath} to ${extractPath}`);
  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `Expand-Archive -LiteralPath ${quotePowerShellLiteral(zipPath)} -DestinationPath ${quotePowerShellLiteral(extractPath)} -Force`,
  ].join('; ');
  await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return extractPath;
}

function locateExtractedExe(extractPath) {
  const direct = path.join(extractPath, PROXY_EXE_NAME);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const matches = [];
  for (const entry of fs.readdirSync(extractPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(extractPath, entry.name, PROXY_EXE_NAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) matches.push(candidate);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('Release zip contains multiple cli-proxy-api.exe files');
  throw new Error('cli-proxy-api.exe not found at the release root or in its single nested folder');
}

async function isProxyRunning() {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', [
      '/FI',
      `IMAGENAME eq ${PROXY_EXE_NAME}`,
      '/NH',
    ], { windowsHide: true });
    return new RegExp(PROXY_EXE_NAME.replace('.', '\\.'), 'i').test(stdout);
  } catch {
    return false;
  }
}

async function waitForProxyState(expectedRunning, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isProxyRunning()) === expectedRunning) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return (await isProxyRunning()) === expectedRunning;
}

async function stopProxyForUpdate(notes) {
  if (!(await isProxyRunning())) {
    notes.push('cli-proxy-api.exe was not running');
    log('update: proxy was not running');
    return false;
  }
  log('update: stopping only cli-proxy-api.exe with taskkill');
  try {
    await execFileAsync('taskkill.exe', ['/IM', PROXY_EXE_NAME, '/F'], {
      windowsHide: true,
    });
  } catch (err) {
    if (await isProxyRunning()) throw err;
  }
  if (!(await waitForProxyState(false, 20000))) {
    throw new Error('Timed out waiting for cli-proxy-api.exe to stop');
  }
  notes.push('Stopped cli-proxy-api.exe only');
  return true;
}

async function startProxyAfterUpdate() {
  ensureDir(path.join(ROOT, 'logs'));
  log('update: starting cli-proxy-api.exe with config.yaml');
  const command = 'start "CLIProxyAPI" /MIN cmd /d /c "cli-proxy-api.exe --config config.yaml >> logs\\proxy.log 2>&1"';
  await execFileAsync('cmd.exe', ['/d', '/s', '/c', command], {
    cwd: ROOT,
    windowsHide: true,
  });
  if (!(await waitForProxyState(true, 20000))) {
    throw new Error('cli-proxy-api.exe did not remain running after restart; check logs/proxy.log');
  }
}

function createBackupPath(currentVersion) {
  ensureDir(path.join(UPDATE_ROOT, 'backup'));
  const fallback = new Date().toISOString().replace(/[:.]/g, '-');
  const label = safeUpdateFolderName(normalizeVersion(currentVersion) || fallback);
  let backupPath = path.join(
    UPDATE_ROOT,
    'backup',
    `cli-proxy-api.${label}.exe.bak`
  );
  if (fs.existsSync(backupPath)) {
    backupPath = path.join(
      UPDATE_ROOT,
      'backup',
      `cli-proxy-api.${label}.${Date.now()}.exe.bak`
    );
  }
  return backupPath;
}

async function applyReleaseUpdate(input = {}) {
  const notes = [];
  const currentVersion = normalizeVersion(input.currentVersion);
  const releaseInfo = await fetchGitHubRelease(input.tagName);
  const tagName = releaseInfo.release.tag_name || normalizeVersion(releaseInfo.release.name);
  const newVersion = normalizeVersion(tagName);
  const download = await downloadReleaseAsset(releaseInfo);
  const extractPath = await extractRelease(tagName, download.zipPath);
  const newExePath = locateExtractedExe(extractPath);
  const newExeBytes = fs.statSync(newExePath).size;
  if (newExeBytes <= MIN_UPDATE_EXE_BYTES) {
    throw new Error(`Extracted cli-proxy-api.exe is too small (${newExeBytes} bytes)`);
  }
  if (!fs.existsSync(PROXY_EXE_PATH)) {
    throw new Error(`Current ${PROXY_EXE_NAME} not found in install root`);
  }

  const backupPath = createBackupPath(currentVersion);
  log(`update: backing up ${PROXY_EXE_PATH} to ${backupPath}`);
  fs.copyFileSync(PROXY_EXE_PATH, backupPath);
  notes.push(`Backup created: ${backupPath}`);

  let replacementAttempted = false;
  let restarted = false;
  try {
    await stopProxyForUpdate(notes);
    replacementAttempted = true;
    log(`update: copying new executable (${newExeBytes} bytes)`);
    fs.copyFileSync(newExePath, PROXY_EXE_PATH);
    notes.push('Replaced only cli-proxy-api.exe; configuration and user data were preserved');

    if (input.restart !== false) {
      await startProxyAfterUpdate();
      restarted = true;
      notes.push('cli-proxy-api.exe restarted successfully');
    } else {
      notes.push('Restart was disabled; start cli-proxy-api.exe manually when ready');
    }

    log(`update: apply completed ${currentVersion || 'unknown'} -> ${newVersion}`);
    return {
      ok: true,
      previousVersion: currentVersion,
      newVersion,
      exePath: PROXY_EXE_PATH,
      backupPath,
      restarted,
      notes,
    };
  } catch (err) {
    log(`update: apply failed: ${err.message}`);
    let rollbackMessage = '';
    if (replacementAttempted && fs.existsSync(backupPath)) {
      try {
        if (await isProxyRunning()) {
          await execFileAsync('taskkill.exe', ['/IM', PROXY_EXE_NAME, '/F'], {
            windowsHide: true,
          });
          await waitForProxyState(false, 20000);
        }
        fs.copyFileSync(backupPath, PROXY_EXE_PATH);
        rollbackMessage = ' Previous executable restored from backup.';
        log('update: rollback restored previous executable');
        if (input.restart !== false) {
          await startProxyAfterUpdate();
          rollbackMessage += ' Previous executable restarted.';
          log('update: rollback restarted previous executable');
        }
      } catch (rollbackError) {
        rollbackMessage = ` Rollback also failed: ${rollbackError.message}`;
        log(`update: rollback failed: ${rollbackError.message}`);
      }
    }
    throw new Error(`${err.message}.${rollbackMessage}`.trim());
  }
}

function getStatusPayload() {
  const authPath = resolveAuthPath();
  const yamlAuth = readAuthDirFromYaml();
  return {
    ok: true,
    installRoot: ROOT,
    cliproxyDir: process.env.CLIPROXY_DIR || ROOT,
    authMode: settings.authMode,
    authPath,
    authPathFromConfig: yamlAuth,
    authPathExists: fs.existsSync(authPath),
    platform: process.platform,
    capabilities: { loginStartup: isWindows, binaryUpdate: isWindows },
    windowsLoginEnabled: isWindowsLoginEnabled(),
    windowsLoginShortcut: isWindows ? startupShortcutPath() : null,
    settings,
    fixedAuthDir: FIXED_AUTH_DIR,
    portableAuthDir: portableAuthDir(),
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
  if (!isWindows && pathname.startsWith('/update/')) {
    sendJson(res, 400, { ok: false, error: 'Automatic binary updates are Windows-only. On macOS, stop the app and replace cli-proxy-api using the matching darwin release.' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, installRoot: ROOT });
      return;
    }

    if (req.method === 'GET' && pathname === '/status') {
      sendJson(res, 200, getStatusPayload());
      return;
    }

    if (req.method === 'GET' && pathname === '/settings') {
      sendJson(res, 200, { ok: true, settings, ...getStatusPayload() });
      return;
    }

    if (req.method === 'PUT' && pathname === '/settings') {
      const body = await readBody(req);
      const merged = { ...settings, ...(body.settings || body) };
      if (body.companionPorts || merged.companionPorts) {
        merged.companionPorts = applyCompanionPorts(
          body.companionPorts || merged.companionPorts
        );
      }
      const saved = saveAppSettings(merged);
      if (typeof body.windowsLoginEnabled === 'boolean') {
        await setWindowsLogin(body.windowsLoginEnabled);
      }
      sendJson(res, 200, { ok: true, settings: saved, ...getStatusPayload() });
      return;
    }

    if (req.method === 'PUT' && pathname === '/windows-login') {
      const body = await readBody(req);
      const result = await setWindowsLogin(Boolean(body.enabled));
      sendJson(res, 200, { ...result, ...getStatusPayload() });
      return;
    }

    if (req.method === 'PUT' && pathname === '/auth-dir') {
      const body = await readBody(req);
      const result = await setAuthLocation({
        mode: body.mode,
        customPath: body.customPath,
        moveFiles: body.moveFiles !== false,
      });
      sendJson(res, 200, { ...result, ...getStatusPayload() });
      return;
    }

    if (req.method === 'POST' && pathname === '/auth-dir/automove') {
      const result = await setAuthLocation({
        mode: 'portable',
        moveFiles: true,
      });
      sendJson(res, 200, { ...result, ...getStatusPayload() });
      return;
    }

    if (req.method === 'POST' && pathname === '/heal-paths') {
      const heal = await healCliproxyDir();
      sendJson(res, 200, { ...heal, ...getStatusPayload() });
      return;
    }

    if (req.method === 'GET' && pathname === '/update/check') {
      const current = url.searchParams.get('current') || '';
      const releaseInfo = await fetchGitHubRelease();
      sendJson(res, 200, releasePayload(releaseInfo, current));
      return;
    }

    if (req.method === 'POST' && pathname === '/update/download') {
      const body = await readBody(req);
      const releaseInfo = await fetchGitHubRelease(body.tagName);
      const result = await downloadReleaseAsset(releaseInfo);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/update/apply') {
      if (updateApplyBusy) {
        sendJson(res, 409, { ok: false, error: 'update already in progress' });
        return;
      }
      updateApplyBusy = true;
      try {
        const body = await readBody(req);
        const result = await applyReleaseUpdate(body);
        sendJson(res, 200, result);
      } finally {
        updateApplyBusy = false;
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log(`request error: ${err.message}`);
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
});

async function boot() {
  ensureDir(resolveAuthPath());
  const heal = await healCliproxyDir();
  for (const note of heal.notes) log(`boot: ${note}`);
  server.listen(config.listenPort, config.listenHost, () => {
    log(`Local settings worker on http://${config.listenHost}:${config.listenPort}`);
    log(`Install root: ${ROOT}`);
  });
}

boot().catch((err) => {
  log(`boot failed: ${err.message}`);
  process.exit(1);
});
