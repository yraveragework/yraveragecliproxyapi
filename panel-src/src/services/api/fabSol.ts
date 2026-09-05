/**
 * Client for the local FabSol session companion worker.
 */

export interface FabSolHeartbeat {
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

export interface FabSolStatus {
  ok: boolean;
  enabled: boolean;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  lastActionAt: number | null;
  proxyOk: boolean;
  proxyError?: string | null;
  hasOrchestratorModel: boolean;
  hasWorkerModel: boolean;
  orchestratorModel: string;
  orchestratorEffort: string;
  workerModel: string;
  workerEffort: string;
  availableModels?: string[];
  orchestratorModels?: string[];
  workerModels?: string[];
  efforts?: string[];
  cpaBaseUrl: string;
  claudeAvailable: boolean;
  claudePath?: string | null;
  heartbeat?: FabSolHeartbeat;
  error?: string;
}

export interface FabSolConfigUpdate {
  orchestratorModel?: string;
  orchestratorEffort?: string;
  workerModel?: string;
  workerEffort?: string;
  heartbeatSeconds?: number;
  tokenPingEnabled?: boolean;
  tokenPingSeconds?: number;
}

const DEFAULT_BASE = 'http://127.0.0.1:19889';

const getBaseUrl = (): string => {
  try {
    const fromWindow = (window as unknown as { __FABSOL_WORKER_URL__?: string }).__FABSOL_WORKER_URL__;
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

export const fabSolApi = {
  health: () => request<{ ok: boolean }>('/health'),
  getStatus: () => request<FabSolStatus>('/status'),
  start: () => request<FabSolStatus>('/start', { method: 'POST' }),
  stop: () => request<FabSolStatus>('/stop', { method: 'POST' }),
  setEnabled: (enabled: boolean) =>
    request<FabSolStatus>('/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  updateConfig: (patch: FabSolConfigUpdate) =>
    request<FabSolStatus>('/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
