/**
 * Loads / updates Claude 5-hour auto-start companion settings.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  claudeAutostartApi,
  isAccountAutostartEnabled,
  type ClaudeAutostartSettings,
} from '@/services/api';
import { useNotificationStore } from '@/stores';

export function useClaudeAutostart(enabled: boolean) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [settings, setSettings] = useState<ClaudeAutostartSettings | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const next = await claudeAutostartApi.getSettings();
      setSettings(next);
      setAvailable(true);
    } catch {
      setAvailable(false);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const setGlobalEnabled = useCallback(
    async (globalEnabled: boolean) => {
      setSaving(true);
      try {
        const next = await claudeAutostartApi.putSettings({ globalEnabled });
        setSettings(next);
        setAvailable(true);
        showNotification(
          globalEnabled
            ? t('claude_quota.autostart_global_on')
            : t('claude_quota.autostart_global_off'),
          'success'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        showNotification(t('claude_quota.autostart_unavailable', { message }), 'error');
        setAvailable(false);
      } finally {
        setSaving(false);
      }
    },
    [showNotification, t]
  );

  const setAccountEnabled = useCallback(
    async (name: string, accountEnabled: boolean) => {
      setSaving(true);
      try {
        const next = await claudeAutostartApi.setAccountEnabled(name, accountEnabled);
        setSettings(next);
        setAvailable(true);
        showNotification(
          accountEnabled
            ? t('claude_quota.autostart_account_on', { name })
            : t('claude_quota.autostart_account_off', { name }),
          'success'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        showNotification(t('claude_quota.autostart_unavailable', { message }), 'error');
        setAvailable(false);
      } finally {
        setSaving(false);
      }
    },
    [showNotification, t]
  );

  return {
    settings,
    available,
    loading,
    saving,
    refresh,
    setGlobalEnabled,
    setAccountEnabled,
    isAccountEnabled: (name: string) => isAccountAutostartEnabled(settings, name),
  };
}
