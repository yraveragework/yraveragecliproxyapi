/**
 * Client for the local Moonshot (Kimi) session companion worker.
 */

export interface MoonshotHeartbeat {
  ok: boolean;
  lastAt: number | null;
  lastError: string | null;
  intervalSeconds: number;
  tokenPingEnabled: boolean;
  tokenPingSeconds: number;
  lastTokenPingAt: number | null;
  lastTokenPingOk: boolean | null;
  lastTokenPingTokens: number | null;
  lastTokenPingError: string | null;
}

export interface MoonshotStatus {
  ok: boolean;
  enabled: boolean;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  lastActionAt: number | null;
  proxyOk: boolean;
  proxyError?: string | null;
  hasSessionModel: boolean;
  sessionModel: string;
  sessionEffort: string;
  kimiModels?: string[];
  efforts?: string[];
  cpaBaseUrl: string;
  claudeAvailable: boolean;
  claudePath?: string | null;
  heartbeat?: MoonshotHeartbeat;
  cursorRouting?: MoonshotCursorRouting;
  error?: string;
}

export interface MoonshotCursorRouting {
  ok: boolean;
  applied?: boolean;
  restored?: boolean;
  openAIBaseUrl?: string | null;
  useOpenAIKey?: boolean | null;
  model?: string;
  reloadRequired?: boolean;
  error?: string | null;
  apiKeyHint?: string;
  baseUrlHint?: string;
  backupExists?: boolean;
}

export interface MoonshotConfigUpdate {
  sessionModel?: string;
  sessionEffort?: string;
  heartbeatSeconds?: number;
  tokenPingEnabled?: boolean;
  tokenPingSeconds?: number;
}

const DEFAULT_BASE = 'http://127.0.0.1:19891';

const getBaseUrl = (): string => {
  try {
    const fromWindow = (window as unknown as { __MOONSHOT_WORKER_URL__?: string })
      .__MOONSHOT_WORKER_URL__;
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

export const moonshotApi = {
  health: () => request<{ ok: boolean }>('/health'),
  getStatus: () => request<MoonshotStatus>('/status'),
  start: () => request<MoonshotStatus>('/start', { method: 'POST' }),
  stop: () => request<MoonshotStatus>('/stop', { method: 'POST' }),
  setEnabled: (enabled: boolean) =>
    request<MoonshotStatus>('/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  updateConfig: (patch: MoonshotConfigUpdate) =>
    request<MoonshotStatus>('/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  applyCursorRouting: () =>
    request<MoonshotStatus>('/cursor-routing/apply', { method: 'POST' }),
  restoreCursorRouting: () =>
    request<MoonshotStatus>('/cursor-routing/restore', { method: 'POST' }),
};
