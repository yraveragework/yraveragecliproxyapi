/**
 * QoL UI preferences synced from local-settings companion / app-settings.json.
 */

import { create } from 'zustand';
import { NOTIFICATION_DURATION_MS } from '@/utils/constants';

interface UiPrefsState {
  autoRefreshSeconds: number;
  notificationsEnabled: boolean;
  notificationDurationMs: number;
  setAutoRefreshSeconds: (seconds: number) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setNotificationDurationMs: (ms: number) => void;
  applyFromAppSettings: (prefs: {
    autoRefreshSeconds?: number;
    notificationsEnabled?: boolean;
    notificationDurationMs?: number;
  }) => void;
}

const STORAGE_KEY = 'cliproxy.uiPrefs';

function loadLocal(): Partial<UiPrefsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<UiPrefsState>;
  } catch {
    return {};
  }
}

function persist(state: UiPrefsState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        autoRefreshSeconds: state.autoRefreshSeconds,
        notificationsEnabled: state.notificationsEnabled,
        notificationDurationMs: state.notificationDurationMs,
      })
    );
  } catch {
    // ignore
  }
}

const initial = loadLocal();

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  autoRefreshSeconds:
    typeof initial.autoRefreshSeconds === 'number' ? initial.autoRefreshSeconds : 30,
  notificationsEnabled:
    typeof initial.notificationsEnabled === 'boolean' ? initial.notificationsEnabled : true,
  notificationDurationMs:
    typeof initial.notificationDurationMs === 'number'
      ? initial.notificationDurationMs
      : NOTIFICATION_DURATION_MS,

  setAutoRefreshSeconds: (seconds) => {
    set({ autoRefreshSeconds: Math.min(600, Math.max(0, seconds)) });
    persist(get());
  },
  setNotificationsEnabled: (enabled) => {
    set({ notificationsEnabled: enabled });
    persist(get());
  },
  setNotificationDurationMs: (ms) => {
    set({ notificationDurationMs: Math.min(30000, Math.max(1000, ms)) });
    persist(get());
  },
  applyFromAppSettings: (prefs) => {
    set((state) => ({
      autoRefreshSeconds:
        typeof prefs.autoRefreshSeconds === 'number'
          ? prefs.autoRefreshSeconds
          : state.autoRefreshSeconds,
      notificationsEnabled:
        typeof prefs.notificationsEnabled === 'boolean'
          ? prefs.notificationsEnabled
          : state.notificationsEnabled,
      notificationDurationMs:
        typeof prefs.notificationDurationMs === 'number'
          ? prefs.notificationDurationMs
          : state.notificationDurationMs,
    }));
    persist(get());
  },
}));
