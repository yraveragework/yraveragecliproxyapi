/**
 * Loads / updates Moonshot (Kimi) companion session status.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moonshotApi, type MoonshotConfigUpdate, type MoonshotStatus } from '@/services/api';
import { useNotificationStore } from '@/stores';

const DEFAULT_POLL_MS = 5000;

export function useMoonshot() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [status, setStatus] = useState<MoonshotStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollMsRef = useRef(DEFAULT_POLL_MS);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await moonshotApi.getStatus();
      setStatus(next);
      setAvailable(true);
      const intervalSec = next.heartbeat?.intervalSeconds;
      if (typeof intervalSec === 'number' && intervalSec > 0) {
        pollMsRef.current = Math.min(60000, Math.max(3000, intervalSec * 1000));
      } else {
        pollMsRef.current = DEFAULT_POLL_MS;
      }
    } catch {
      setAvailable(false);
      setStatus(null);
      pollMsRef.current = DEFAULT_POLL_MS;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await refresh();
        if (!cancelled) schedule();
      }, pollMsRef.current);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setSaving(true);
      try {
        const next = await moonshotApi.setEnabled(enabled);
        setStatus(next);
        setAvailable(true);
        showNotification(
          enabled ? t('moonshot.started') : t('moonshot.stopped'),
          'success'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        showNotification(t('moonshot.action_failed', { message }), 'error');
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh, showNotification, t]
  );

  const updateConfig = useCallback(
    async (patch: MoonshotConfigUpdate) => {
      setSaving(true);
      try {
        const next = await moonshotApi.updateConfig(patch);
        setStatus(next);
        setAvailable(true);
        showNotification(t('moonshot.config_saved'), 'success');
        return next;
      } catch (err) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        showNotification(t('moonshot.action_failed', { message }), 'error');
        await refresh();
        return null;
      } finally {
        setSaving(false);
      }
    },
    [refresh, showNotification, t]
  );

  const restartSession = useCallback(async () => {
    setSaving(true);
    try {
      await moonshotApi.setEnabled(false);
      const next = await moonshotApi.setEnabled(true);
      setStatus(next);
      setAvailable(true);
      showNotification(t('moonshot.restarted'), 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(t('moonshot.action_failed', { message }), 'error');
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh, showNotification, t]);

  const applyCursorRouting = useCallback(async () => {
    setSaving(true);
    try {
      const next = await moonshotApi.applyCursorRouting();
      setStatus(next);
      setAvailable(true);
      showNotification(t('moonshot.cursor_applied'), 'success');
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(t('moonshot.action_failed', { message }), 'error');
      await refresh();
      return null;
    } finally {
      setSaving(false);
    }
  }, [refresh, showNotification, t]);

  return {
    status,
    available,
    loading,
    saving,
    refresh,
    setEnabled,
    updateConfig,
    restartSession,
    applyCursorRouting,
  };
}
