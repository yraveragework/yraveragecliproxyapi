/**
 * Client for the local Claude 5-hour auto-start companion worker.
 */

export interface ClaudeAutostartAccountSetting {
  enabled?: boolean;
}

export interface ClaudeAutostartSettings {
  globalEnabled: boolean;
  checkIntervalSeconds: number;
  model: string;
  maxTokens: number;
  accounts: Record<string, ClaudeAutostartAccountSetting>;
}

export interface ClaudeAutostartAccountStatus {
  enabled: boolean;
  lastPingAt: number | null;
  lastResult: string;
  lastError: string | null;
  lastCheckedAt: number | null;
  needsStart: boolean | null;
}

export interface ClaudeAutostartStatus {
  ok: boolean;
  globalEnabled: boolean;
  checkIntervalSeconds: number;
  model: string;
  maxTokens: number;
  lastLoopAt: number | null;
  lastLoopError: string | null;
  accounts: Record<string, ClaudeAutostartAccountStatus>;
}

const DEFAULT_BASE = 'http://127.0.0.1:19888';

const getBaseUrl = (): string => {
  try {
    const fromWindow = (window as unknown as { __CLAUDE_AUTOSTART_URL__?: string })
      .__CLAUDE_AUTOSTART_URL__;
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

export const claudeAutostartApi = {
  getSettings: () => request<ClaudeAutostartSettings>('/settings'),
  putSettings: (settings: Partial<ClaudeAutostartSettings>) =>
    request<ClaudeAutostartSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  setAccountEnabled: (name: string, enabled: boolean) =>
    request<ClaudeAutostartSettings>(`/settings/accounts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  getStatus: () => request<ClaudeAutostartStatus>('/status'),
  health: () => request<{ ok: boolean }>('/health'),
};

export function isAccountAutostartEnabled(
  settings: ClaudeAutostartSettings | null | undefined,
  name: string
): boolean {
  if (!settings?.globalEnabled) return false;
  return settings.accounts?.[name]?.enabled !== false;
}
