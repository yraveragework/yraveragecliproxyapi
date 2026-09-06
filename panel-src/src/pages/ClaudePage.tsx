import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useClaudeSession } from '@/pages/hooks/useClaudeSession';
import { resolveClaudeAndon } from '@/pages/hooks/useClaudeAndon';
import styles from './ClaudePage.module.scss';

const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_CLAUDE = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];
const HEARTBEAT_OPTIONS = [
  { value: '0', labelKey: 'claude.heartbeat_off' as const },
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '60s' },
];
const TOKEN_PING_OPTIONS = [
  { value: '60', label: '1m' },
  { value: '120', label: '2m' },
  { value: '300', label: '5m' },
  { value: '600', label: '10m' },
];

function formatTime(value: number | null | undefined, locale: string) {
  if (!value) return 'â€”';
  try {
    return new Date(value).toLocaleString(locale);
  } catch {
    return new Date(value).toLocaleString();
  }
}

function toOptions(ids: string[]) {
  return ids.map((value) => ({ value, label: value }));
}

function ensureSelected(ids: string[] | undefined, selected: string | undefined, fallback: string[]) {
  const base = ids?.length ? [...ids] : [...fallback];
  if (selected && !base.includes(selected)) base.unshift(selected);
  return base;
}

export function ClaudePage() {
  const { t, i18n } = useTranslation();
  const { status, available, loading, saving, refresh, setEnabled, updateConfig, restartSession } =
    useClaudeSession();

  const andonTone = useMemo(() => resolveClaudeAndon(status, available), [available, status]);

  const badge = useMemo(() => {
    if (andonTone === 'offline') {
      return { type: 'warning' as const, label: t('claude.status_worker_offline') };
    }
    if (andonTone === 'down') {
      return { type: 'error' as const, label: t('claude.andon_down') };
    }
    if (andonTone === 'ok') {
      return { type: 'success' as const, label: t('claude.status_running') };
    }
    return { type: 'muted' as const, label: t('claude.status_stopped') };
  }, [andonTone, t]);

  const heartbeatOptions = useMemo(
    () =>
      HEARTBEAT_OPTIONS.map((opt) => ({
        value: opt.value,
        label: 'labelKey' in opt && opt.labelKey ? t(opt.labelKey) : (opt.label as string),
      })),
    [t]
  );

  const claudeOptions = useMemo(
    () => toOptions(ensureSelected(status?.claudeModels, status?.sessionModel, FALLBACK_CLAUDE)),
    [status?.claudeModels, status?.sessionModel]
  );

  const effortOptions = useMemo(
    () => toOptions(status?.efforts?.length ? status.efforts : FALLBACK_EFFORTS),
    [status?.efforts]
  );

  const readiness = useMemo(() => {
    if (!available || !status) return [];
    return [
      {
        ok: status.claudeAvailable,
        label: t('claude.check_claude'),
        detail: status.claudeAvailable
          ? status.claudePath || t('common.yes')
          : t('claude.claude_missing'),
      },
      ...(status.platform === 'darwin' ? [] : [{
        ok: status.hasLogin,
        label: t('claude.check_login'),
        detail: status.hasLogin ? status.loginPath || t('common.yes') : t('claude.login_missing'),
      }]),
      {
        ok: status.hasSessionModel,
        label: t('claude.check_model'),
        detail: `${status.sessionModel} @ ${status.sessionEffort || 'high'}`,
      },
    ];
  }, [available, status, t]);

  const controlsDisabled = !available || saving || loading;

  return (
    <div className={styles.page}>
      <Card
        title={t('claude.title')}
        extra={
          <div className={styles.headerExtra}>
            <span className={`status-badge ${badge.type}`}>{badge.label}</span>
            <Button type="button" onClick={() => void refresh()} disabled={loading || saving}>
              {t('common.refresh')}
            </Button>
          </div>
        }
      >
        <p className={styles.lead}>{t('claude.description')}</p>
        {status?.platform === 'darwin' ? <p className={styles.lead}>macOS login may be stored in Keychain. Confirm your login in Claude Code; this panel does not inspect Keychain credentials.</p> : null}
        {status?.platform === 'darwin' ? <p className={styles.lead}>macOS login may be stored in Keychain. Confirm your login in Claude Code; this panel does not inspect Keychain credentials.</p> : null}

        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('claude.toggle_label')}</div>
            <div className={styles.controlHint}>
              {available ? t('claude.toggle_hint') : t('claude.worker_offline_hint')}
            </div>
          </div>
          <ToggleSwitch
            checked={Boolean(status?.running)}
            onChange={(value) => void setEnabled(value)}
            disabled={!available || saving || loading}
            ariaLabel={t('claude.toggle_label')}
            label={status?.running ? t('claude.on') : t('claude.off')}
          />
        </div>

        {status?.lastError ? <div className={styles.errorBox}>{status.lastError}</div> : null}

        <div className={styles.andonSection}>
          <div className={styles.andonHeader}>
            <div>
              <div className={styles.andonTitle}>{t('claude.andon_title')}</div>
              <div className={styles.andonHint}>{t('claude.andon_hint')}</div>
            </div>
            <span
              className={`${styles.andonLamp} ${styles[`andonLamp_${andonTone}`]}`}
              title={badge.label}
              aria-label={badge.label}
            />
          </div>
          <div className={styles.andonGrid}>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('claude.heartbeat_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('claude.heartbeat_interval')}
                value={String(status?.heartbeat?.intervalSeconds ?? 15)}
                options={heartbeatOptions}
                disabled={controlsDisabled}
                onChange={(value) => void updateConfig({ heartbeatSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('claude.heartbeat_last')}</span>
              <span className={styles.metaValue}>
                {formatTime(status?.heartbeat?.lastAt, i18n.language)}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('claude.heartbeat_result')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.ok
                  ? t('claude.andon_ok')
                  : status?.heartbeat?.lastError || t('common.no')}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('claude.token_ping')}</span>
              <ToggleSwitch
                checked={Boolean(status?.heartbeat?.tokenPingEnabled)}
                onChange={(value) => void updateConfig({ tokenPingEnabled: value })}
                disabled={controlsDisabled}
                ariaLabel={t('claude.token_ping')}
                label={status?.heartbeat?.tokenPingEnabled ? t('claude.on') : t('claude.off')}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('claude.token_ping_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('claude.token_ping_interval')}
                value={String(status?.heartbeat?.tokenPingSeconds ?? 300)}
                options={TOKEN_PING_OPTIONS}
                disabled={controlsDisabled || !status?.heartbeat?.tokenPingEnabled}
                onChange={(value) => void updateConfig({ tokenPingSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('claude.token_ping_last')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.tokenPingEnabled
                  ? status.heartbeat.lastTokenPingOk == null
                    ? 'â€”'
                    : status.heartbeat.lastTokenPingOk
                      ? t('claude.token_ping_ok', {
                          tokens: status.heartbeat.lastTokenPingTokens ?? '?',
                        })
                      : status.heartbeat.lastTokenPingError || t('common.error')
                  : t('claude.token_ping_off_hint')}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('claude.pid')}</span>
            <span className={styles.metaValue}>{status?.pid ?? 'â€”'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('claude.started_at')}</span>
            <span className={styles.metaValue}>{formatTime(status?.startedAt, i18n.language)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('claude.session_model')}</span>
            <Select
              size="sm"
              ariaLabel={t('claude.session_model')}
              value={status?.sessionModel ?? 'claude-fable-5'}
              options={claudeOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ sessionModel: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('claude.session_effort')}</span>
            <Select
              size="sm"
              ariaLabel={t('claude.session_effort')}
              value={status?.sessionEffort ?? 'high'}
              options={effortOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ sessionEffort: value })}
            />
          </div>
        </div>

        {status?.running ? (
          <div className={styles.restartBanner}>
            <div>
              <div className={styles.restartTitle}>{t('claude.restart_needed_title')}</div>
              <div className={styles.restartHint}>{t('claude.restart_needed_hint')}</div>
            </div>
            <Button type="button" onClick={() => void restartSession()} disabled={controlsDisabled}>
              {t('claude.restart')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title={t('claude.readiness_title')}>
        {!available ? (
          <p className={styles.lead}>{t('claude.worker_offline_hint')}</p>
        ) : (
          <ul className={styles.checkList}>
            {readiness.map((item) => (
              <li key={item.label} className={styles.checkItem}>
                <span className={`status-badge ${item.ok ? 'success' : 'error'}`}>
                  {item.ok ? t('common.yes') : t('common.no')}
                </span>
                <div>
                  <div className={styles.checkLabel}>{item.label}</div>
                  <div className={styles.checkDetail}>{item.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('claude.how_title')}>
        <ol className={styles.steps}>
          <li>{t('claude.how_1')}</li>
          <li>{t('claude.how_2')}</li>
          <li>{t('claude.how_3')}</li>
        </ol>
      </Card>
    </div>
  );
}
