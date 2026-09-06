import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useLocalSettings } from '@/pages/hooks/useLocalSettings';
import { useClaudeAutostart } from '@/components/quota/useClaudeAutostart';
import {
  useLanguageStore,
  useNotificationStore,
  useThemeStore,
} from '@/stores';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import type { AuthMode } from '@/services/api/localSettings';
import type { Theme } from '@/types';
import styles from './SettingsPage.module.scss';

const THEME_OPTIONS: { key: Theme; labelKey: string }[] = [
  { key: 'auto', labelKey: 'theme.auto' },
  { key: 'light', labelKey: 'theme.light' },
  { key: 'dark', labelKey: 'theme.dark' },
  { key: 'white', labelKey: 'theme.white' },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);
  const { language, setLanguage } = useLanguageStore();
  const { theme, setTheme } = useThemeStore();

  const {
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
  } = useLocalSettings();

  const {
    settings: autostartSettings,
    available: autostartAvailable,
    loading: autostartLoading,
    saving: autostartSaving,
    setGlobalEnabled,
    refresh: refreshAutostart,
  } = useClaudeAutostart(true);

  const [authMode, setAuthModeLocal] = useState<AuthMode>('fixed');
  const [customPath, setCustomPath] = useState('');
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(30);
  const [notificationDurationMs, setNotificationDurationMs] = useState(3000);
  const [portAutostart, setPortAutostart] = useState(19888);
  const [portFabSol, setPortFabSol] = useState(19889);
  const [portFabKim, setPortFabKim] = useState(19892);
  const [portLocal, setPortLocal] = useState(19890);

  useEffect(() => {
    if (!status?.settings) return;
    setAuthModeLocal(status.settings.authMode);
    setCustomPath(status.settings.authCustomPath || '');
    setAutoRefreshSeconds(status.settings.autoRefreshSeconds);
    setNotificationDurationMs(status.settings.notificationDurationMs);
    setPortAutostart(status.settings.companionPorts.claudeAutostart);
    setPortFabSol(status.settings.companionPorts.fabSol);
    setPortFabKim(status.settings.companionPorts.fabKim ?? 19892);
    setPortLocal(status.settings.companionPorts.localSettings);
  }, [status]);

  const previewAuthPath = useMemo(() => {
    if (!status) return '—';
    if (authMode === 'portable') return status.portableAuthDir;
    if (authMode === 'custom') return customPath.trim() || status.fixedAuthDir;
    return status.fixedAuthDir;
  }, [authMode, customPath, status]);

  const workerBadge = available
    ? { type: 'success' as const, label: t('app_settings.worker_online') }
    : { type: 'warning' as const, label: t('app_settings.worker_offline') };

  const run = async (action: () => Promise<unknown>, successKey: string) => {
    try {
      await action();
      showNotification(t(successKey), 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <div className={styles.page}>
      <Card
        title={t('app_settings.title')}
        extra={
          <div className={styles.headerExtra}>
            <span className={`status-badge ${workerBadge.type}`}>{workerBadge.label}</span>
            <Button
              type="button"
              onClick={() => {
                void refresh();
                void refreshAutostart();
              }}
              disabled={loading || saving}
            >
              {t('common.refresh')}
            </Button>
          </div>
        }
      >
        <p className={styles.lead}>{t('app_settings.description')}</p>
        {!available ? (
          <div className={styles.errorBox}>{t('app_settings.worker_offline_hint')}</div>
        ) : null}
        {error ? <div className={styles.errorBox}>{error}</div> : null}
      </Card>

      <Card title={t('app_settings.section_startup')}>
        {status?.platform === 'darwin' ? (
          <p className={styles.lead}>macOS: use start.command to launch the app. Helpers run in the background; agent terminals open when you enable a feature. Windows login startup and automatic binary updates are unavailable on this platform.</p>
        ) : null}
        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('app_settings.windows_login')}</div>
            <div className={styles.controlHint}>{t('app_settings.windows_login_hint')}</div>
          </div>
          <ToggleSwitch
            checked={Boolean(status?.windowsLoginEnabled)}
            onChange={(value) =>
              void run(() => setWindowsLogin(value), 'app_settings.saved')
            }
            disabled={!available || saving || loading || status?.capabilities?.loginStartup === false}
            label={status?.windowsLoginEnabled ? t('common.on') : t('common.off')}
            ariaLabel={t('app_settings.windows_login')}
          />
        </div>

        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('app_settings.open_panel')}</div>
            <div className={styles.controlHint}>{t('app_settings.open_panel_hint')}</div>
          </div>
          <ToggleSwitch
            checked={status?.settings.openPanelOnStart !== false}
            onChange={(value) =>
              void run(() => putSettings({ openPanelOnStart: value }), 'app_settings.saved')
            }
            disabled={!available || saving || loading}
            label={status?.settings.openPanelOnStart !== false ? t('common.on') : t('common.off')}
            ariaLabel={t('app_settings.open_panel')}
          />
        </div>

        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('app_settings.start_minimized')}</div>
            <div className={styles.controlHint}>{t('app_settings.start_minimized_hint')}</div>
          </div>
          <ToggleSwitch
            checked={status?.settings.startMinimized !== false}
            onChange={(value) =>
              void run(() => putSettings({ startMinimized: value }), 'app_settings.saved')
            }
            disabled={!available || saving || loading}
            label={status?.settings.startMinimized !== false ? t('common.on') : t('common.off')}
            ariaLabel={t('app_settings.start_minimized')}
          />
        </div>
      </Card>

      <Card title={t('app_settings.section_claude_autostart')}>
        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('claude_quota.autostart_global_label')}</div>
            <div className={styles.controlHint}>
              {autostartAvailable
                ? t('claude_quota.autostart_global_hint')
                : t('claude_quota.autostart_worker_offline')}
            </div>
          </div>
          <ToggleSwitch
            checked={Boolean(autostartSettings?.globalEnabled)}
            onChange={(value) =>
              void run(async () => {
                await setGlobalEnabled(value);
              }, value ? 'claude_quota.autostart_global_on' : 'claude_quota.autostart_global_off')
            }
            disabled={!autostartAvailable || autostartLoading || autostartSaving}
            label={
              autostartSettings?.globalEnabled ? t('common.on') : t('common.off')
            }
            ariaLabel={t('claude_quota.autostart_global_label')}
          />
        </div>
      </Card>

      <Card title={t('app_settings.section_auth')}>
        <p className={styles.lead}>{t('app_settings.auth_hint')}</p>
        <div className={styles.modeRow}>
          {(
            [
              ['fixed', 'app_settings.auth_mode_fixed'],
              ['custom', 'app_settings.auth_mode_custom'],
              ['portable', 'app_settings.auth_mode_portable'],
            ] as const
          ).map(([mode, labelKey]) => (
            <button
              key={mode}
              type="button"
              className={`${styles.modeButton} ${authMode === mode ? styles.active : ''}`}
              disabled={!available || saving}
              onClick={() => setAuthModeLocal(mode)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {authMode === 'custom' ? (
          <div className={styles.fieldRow}>
            <input
              className={styles.input}
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder={t('app_settings.auth_custom_placeholder')}
              disabled={!available || saving}
            />
          </div>
        ) : null}

        <div className={styles.pathBox}>
          <span className={styles.pathLabel}>{t('app_settings.auth_path_label')}</span>
          {previewAuthPath}
        </div>
        {status?.authPathFromConfig && status.authPathFromConfig !== previewAuthPath ? (
          <div className={styles.pathBox}>
            <span className={styles.pathLabel}>{t('app_settings.auth_path_active')}</span>
            {status.authPathFromConfig}
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button
            type="button"
            disabled={!available || saving}
            onClick={() =>
              void run(
                () =>
                  setAuthDir({
                    mode: authMode,
                    customPath: authMode === 'custom' ? customPath : undefined,
                    moveFiles: true,
                  }),
                'app_settings.auth_moved'
              )
            }
          >
            {t('app_settings.auth_apply_move')}
          </Button>
          <Button
            type="button"
            disabled={!available || saving}
            onClick={() =>
              void run(async () => {
                setAuthModeLocal('portable');
                await autoMoveAuth();
              }, 'app_settings.auth_automoved')
            }
          >
            {t('app_settings.auth_automove')}
          </Button>
        </div>
      </Card>

      <Card title={t('app_settings.section_qol')}>
        <div className={styles.fieldRow}>
          <label className={styles.controlLabel} htmlFor="auto-refresh">
            {t('app_settings.auto_refresh')}
          </label>
          <select
            id="auto-refresh"
            className={styles.select}
            value={autoRefreshSeconds}
            disabled={!available || saving}
            onChange={(e) => setAutoRefreshSeconds(Number(e.target.value))}
          >
            <option value={0}>{t('app_settings.auto_refresh_off')}</option>
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
            <option value={120}>120s</option>
          </select>
        </div>
        <div className={styles.controlHint}>{t('app_settings.auto_refresh_hint')}</div>

        <div className={styles.controlRow} style={{ marginTop: 12 }}>
          <div>
            <div className={styles.controlLabel}>{t('app_settings.notifications')}</div>
            <div className={styles.controlHint}>{t('app_settings.notifications_hint')}</div>
          </div>
          <ToggleSwitch
            checked={status?.settings.notificationsEnabled !== false}
            onChange={(value) =>
              void run(
                () => putSettings({ notificationsEnabled: value }),
                'app_settings.saved'
              )
            }
            disabled={!available || saving}
            label={
              status?.settings.notificationsEnabled !== false
                ? t('common.on')
                : t('common.off')
            }
            ariaLabel={t('app_settings.notifications')}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.controlLabel} htmlFor="toast-ms">
            {t('app_settings.notification_duration')}
          </label>
          <select
            id="toast-ms"
            className={styles.select}
            value={notificationDurationMs}
            disabled={!available || saving}
            onChange={(e) => setNotificationDurationMs(Number(e.target.value))}
          >
            <option value={2000}>2s</option>
            <option value={3000}>3s</option>
            <option value={5000}>5s</option>
            <option value={8000}>8s</option>
          </select>
        </div>

        <div className={styles.actions}>
          <Button
            type="button"
            disabled={!available || saving}
            onClick={() =>
              void run(
                () =>
                  putSettings({
                    autoRefreshSeconds,
                    notificationDurationMs,
                  }),
                'app_settings.saved'
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>

        <div className={styles.controlLabel} style={{ marginTop: 16 }}>
          {t('app_settings.language')}
        </div>
        <div className={styles.chipRow}>
          {LANGUAGE_ORDER.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`${styles.chip} ${language === lang ? styles.active : ''}`}
              onClick={() => {
                if (isSupportedLanguage(lang)) setLanguage(lang);
              }}
            >
              {t(LANGUAGE_LABEL_KEYS[lang])}
            </button>
          ))}
        </div>

        <div className={styles.controlLabel} style={{ marginTop: 16 }}>
          {t('app_settings.theme')}
        </div>
        <div className={styles.chipRow}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`${styles.chip} ${theme === opt.key ? styles.active : ''}`}
              onClick={() => setTheme(opt.key)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t('app_settings.section_ports')}>
        <p className={styles.lead}>{t('app_settings.ports_hint')}</p>
        <div className={styles.fieldRow}>
          <label className={styles.controlLabel}>{t('app_settings.port_autostart')}</label>
          <input
            className={styles.input}
            type="number"
            value={portAutostart}
            disabled={!available || saving}
            onChange={(e) => setPortAutostart(Number(e.target.value))}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.controlLabel}>{t('app_settings.port_fabsol')}</label>
          <input
            className={styles.input}
            type="number"
            value={portFabSol}
            disabled={!available || saving}
            onChange={(e) => setPortFabSol(Number(e.target.value))}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.controlLabel}>{t('app_settings.port_fabkim')}</label>
          <input
            className={styles.input}
            type="number"
            value={portFabKim}
            disabled={!available || saving}
            onChange={(e) => setPortFabKim(Number(e.target.value))}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.controlLabel}>{t('app_settings.port_settings')}</label>
          <input
            className={styles.input}
            type="number"
            value={portLocal}
            disabled={!available || saving}
            onChange={(e) => setPortLocal(Number(e.target.value))}
          />
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            disabled={!available || saving}
            onClick={() =>
              void run(
                () =>
                  putSettings({
                    companionPorts: {
                      claudeAutostart: portAutostart,
                      fabSol: portFabSol,
                      fabKim: portFabKim,
                      localSettings: portLocal,
                    },
                  }),
                'app_settings.ports_saved'
              )
            }
          >
            {t('app_settings.save_ports')}
          </Button>
        </div>
      </Card>

      <Card title={t('app_settings.section_install')}>
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('app_settings.install_root')}</span>
            <span className={styles.metaValue}>{status?.installRoot || '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('app_settings.cliproxy_dir')}</span>
            <span className={styles.metaValue}>{status?.cliproxyDir || '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('app_settings.login_shortcut')}</span>
            <span className={styles.metaValue}>{status?.windowsLoginShortcut || '—'}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            disabled={!available || saving}
            onClick={() => void run(() => healPaths(), 'app_settings.healed')}
          >
            {t('app_settings.heal_paths')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
