/**
 * Client for the local Claude-only session companion worker.
 */

export interface ClaudeHeartbeat {
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

export interface ClaudeStatus {
  platform?: string;
  ok: boolean;
  enabled: boolean;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  lastActionAt: number | null;
  claudeAvailable: boolean;
  claudePath?: string | null;
  hasLogin: boolean;
  loginPath?: string | null;
  hasSessionModel: boolean;
  sessionModel: string;
  sessionEffort: string;
  claudeModels?: string[];
  efforts?: string[];
  heartbeat?: ClaudeHeartbeat;
  error?: string;
}

export interface ClaudeConfigUpdate {
  sessionModel?: string;
  sessionEffort?: string;
  heartbeatSeconds?: number;
  tokenPingEnabled?: boolean;
  tokenPingSeconds?: number;
}

const DEFAULT_BASE = 'http://127.0.0.1:19893';

const getBaseUrl = (): string => {
  try {
    const fromWindow = (window as unknown as { __CLAUDE_WORKER_URL__?: string })
      .__CLAUDE_WORKER_URL__;
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

export const claudeSessionApi = {
  health: () => request<{ ok: boolean }>('/health'),
  getStatus: () => request<ClaudeStatus>('/status'),
  start: () => request<ClaudeStatus>('/start', { method: 'POST' }),
  stop: () => request<ClaudeStatus>('/stop', { method: 'POST' }),
  setEnabled: (enabled: boolean) =>
    request<ClaudeStatus>('/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  updateConfig: (patch: ClaudeConfigUpdate) =>
    request<ClaudeStatus>('/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
