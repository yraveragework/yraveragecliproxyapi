/**
 * Client for the local settings companion worker (path healing, login start, auth dir).
 */

export type AuthMode = 'fixed' | 'portable' | 'custom';

export interface AppSettings {
  windowsLoginEnabled: boolean;
  openPanelOnStart: boolean;
  startMinimized: boolean;
  authMode: AuthMode;
  authCustomPath: string;
  autoRefreshSeconds: number;
  notificationsEnabled: boolean;
  notificationDurationMs: number;
  companionPorts: {
    claudeAutostart: number;
    fabSol: number;
    fabKim: number;
    localSettings: number;
  };
}

export interface LocalSettingsStatus {
  ok: boolean;
  installRoot: string;
  cliproxyDir: string;
  authMode: AuthMode;
  authPath: string;
  authPathFromConfig?: string | null;
  authPathExists: boolean;
  windowsLoginEnabled: boolean;
  windowsLoginShortcut?: string;
  settings: AppSettings;
  fixedAuthDir: string;
  portableAuthDir: string;
  error?: string;
}

export interface UpdateReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  current: string;
  latest: string;
  updateAvailable: boolean;
  tagName: string;
  name: string | null;
  body: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  asset: UpdateReleaseAsset;
  installRoot: string;
}

export interface UpdateDownloadResult {
  ok: boolean;
  tagName: string;
  zipPath: string;
  bytes: number;
  assetName: string;
}

export interface ApplyUpdatePayload {
  currentVersion: string;
  tagName?: string;
  restart: boolean;
}

export interface ApplyUpdateResult {
  ok: boolean;
  previousVersion: string;
  newVersion: string;
  exePath: string;
  backupPath: string;
  restarted: boolean;
  notes?: string[];
}

const DEFAULT_BASE = 'http://127.0.0.1:19890';

const getBaseUrl = (): string => {
  try {
    const fromWindow = (window as unknown as { __LOCAL_SETTINGS_URL__?: string })
      .__LOCAL_SETTINGS_URL__;
    if (fromWindow && fromWindow.trim()) return fromWindow.trim().replace(/\/+$/, '');
  } catch {
    // ignore
  }
  return DEFAULT_BASE;
};

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const localSettingsApi = {
  health: () => request<{ ok: boolean; installRoot?: string }>('/health'),
  getStatus: () => request<LocalSettingsStatus>('/status'),
  getSettings: () =>
    request<LocalSettingsStatus & { settings: AppSettings }>('/settings'),
  putSettings: (settings: Partial<AppSettings>) =>
    request<LocalSettingsStatus>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  setWindowsLogin: (enabled: boolean) =>
    request<LocalSettingsStatus>('/windows-login', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  setAuthDir: (payload: { mode: AuthMode; customPath?: string; moveFiles?: boolean }) =>
    request<LocalSettingsStatus & { filesCopied?: number; path?: string }>(
      '/auth-dir',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  autoMoveAuth: () =>
    request<LocalSettingsStatus & { filesCopied?: number; path?: string }>(
      '/auth-dir/automove',
      { method: 'POST' }
    ),
  healPaths: () =>
    request<LocalSettingsStatus & { notes?: string[] }>('/heal-paths', {
      method: 'POST',
    }),
  checkUpdate: (current: string) =>
    request<UpdateCheckResult>(`/update/check?current=${encodeURIComponent(current)}`),
  downloadUpdate: (tagName?: string) =>
    request<UpdateDownloadResult>('/update/download', {
      method: 'POST',
      body: JSON.stringify(tagName ? { tagName } : {}),
    }),
  applyUpdate: (payload: ApplyUpdatePayload) =>
    request<ApplyUpdateResult>('/update/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
