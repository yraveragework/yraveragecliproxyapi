import { useCallback, useEffect, useState } from 'react';
import {
  localSettingsApi,
  type AppSettings,
  type AuthMode,
  type LocalSettingsStatus,
} from '@/services/api/localSettings';
import { useUiPrefsStore } from '@/stores/useUiPrefsStore';

export function useLocalSettings() {
  const applyFromAppSettings = useUiPrefsStore((s) => s.applyFromAppSettings);
  const [status, setStatus] = useState<LocalSettingsStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await localSettingsApi.getStatus();
      setStatus(next);
      setAvailable(true);
      if (next.settings) applyFromAppSettings(next.settings);
    } catch (err) {
      setAvailable(false);
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [applyFromAppSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const putSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      setSaving(true);
      setError(null);
      try {
        const next = await localSettingsApi.putSettings(partial);
        setStatus(next);
        setAvailable(true);
        if (next.settings) applyFromAppSettings(next.settings);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [applyFromAppSettings]
  );

  const setWindowsLogin = useCallback(
    async (enabled: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const next = await localSettingsApi.setWindowsLogin(enabled);
        setStatus(next);
        setAvailable(true);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const setAuthDir = useCallback(
    async (payload: { mode: AuthMode; customPath?: string; moveFiles?: boolean }) => {
      setSaving(true);
      setError(null);
      try {
        const next = await localSettingsApi.setAuthDir(payload);
        setStatus(next);
        setAvailable(true);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const autoMoveAuth = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await localSettingsApi.autoMoveAuth();
      setStatus(next);
      setAvailable(true);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const healPaths = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await localSettingsApi.healPaths();
      setStatus(next);
      setAvailable(true);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    status,
    available,
    loading,
    saving,
    error,
    refresh,
    putSettings,
    setWindowsLogin,
    setAuthDir,
    autoMoveAuth,
    healPaths,
  };
}
