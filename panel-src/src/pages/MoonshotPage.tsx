import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useMoonshot } from '@/pages/hooks/useMoonshot';
import { resolveMoonshotAndon } from '@/pages/hooks/useMoonshotAndon';
import styles from './MoonshotPage.module.scss';

const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_KIMI = [
  'kimi-k3',
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2',
  'kimi-k2-thinking',
];
const HEARTBEAT_OPTIONS = [
  { value: '0', labelKey: 'moonshot.heartbeat_off' as const },
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
  if (!value) return '—';
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

export function MoonshotPage() {
  const { t, i18n } = useTranslation();
  const {
    status,
    available,
    loading,
    saving,
    refresh,
    setEnabled,
    updateConfig,
    restartSession,
    applyCursorRouting,
  } = useMoonshot();

  const andonTone = useMemo(
    () => resolveMoonshotAndon(status, available),
    [available, status]
  );

  const badge = useMemo(() => {
    if (andonTone === 'offline') {
      return { type: 'warning' as const, label: t('moonshot.status_worker_offline') };
    }
    if (andonTone === 'down') {
      return { type: 'error' as const, label: t('moonshot.andon_down') };
    }
    if (andonTone === 'ok') {
      return { type: 'success' as const, label: t('moonshot.status_running') };
    }
    return { type: 'muted' as const, label: t('moonshot.status_stopped') };
  }, [andonTone, t]);

  const heartbeatOptions = useMemo(
    () =>
      HEARTBEAT_OPTIONS.map((opt) => ({
        value: opt.value,
        label: 'labelKey' in opt && opt.labelKey ? t(opt.labelKey) : (opt.label as string),
      })),
    [t]
  );

  const kimiOptions = useMemo(
    () => toOptions(ensureSelected(status?.kimiModels, status?.sessionModel, FALLBACK_KIMI)),
    [status?.kimiModels, status?.sessionModel]
  );

  const effortOptions = useMemo(
    () => toOptions(status?.efforts?.length ? status.efforts : FALLBACK_EFFORTS),
    [status?.efforts]
  );

  const readiness = useMemo(() => {
    if (!available || !status) return [];
    return [
      {
        ok: status.proxyOk,
        label: t('moonshot.check_proxy'),
        detail: status.proxyOk ? status.cpaBaseUrl : status.proxyError || t('common.error'),
      },
      {
        ok: status.claudeAvailable,
        label: t('moonshot.check_claude'),
        detail: status.claudeAvailable
          ? status.claudePath || t('common.yes')
          : t('moonshot.claude_missing'),
      },
      {
        ok: status.hasSessionModel,
        label: t('moonshot.check_model'),
        detail: `${status.sessionModel} @ ${status.sessionEffort || 'high'}`,
      },
    ];
  }, [available, status, t]);

  const controlsDisabled = !available || saving || loading;

  return (
    <div className={styles.page}>
      <Card
        title={t('moonshot.title')}
        extra={
          <div className={styles.headerExtra}>
            <span className={`status-badge ${badge.type}`}>{badge.label}</span>
            <Button type="button" onClick={() => void refresh()} disabled={loading || saving}>
              {t('common.refresh')}
            </Button>
          </div>
        }
      >
        <p className={styles.lead}>{t('moonshot.description')}</p>

        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('moonshot.toggle_label')}</div>
            <div className={styles.controlHint}>
              {available ? t('moonshot.toggle_hint') : t('moonshot.worker_offline_hint')}
            </div>
          </div>
          <ToggleSwitch
            checked={Boolean(status?.running)}
            onChange={(value) => void setEnabled(value)}
            disabled={!available || saving || loading}
            ariaLabel={t('moonshot.toggle_label')}
            label={status?.running ? t('moonshot.on') : t('moonshot.off')}
          />
        </div>

        {status?.lastError ? <div className={styles.errorBox}>{status.lastError}</div> : null}

        <div className={styles.andonSection}>
          <div className={styles.andonHeader}>
            <div>
              <div className={styles.andonTitle}>{t('moonshot.andon_title')}</div>
              <div className={styles.andonHint}>{t('moonshot.andon_hint')}</div>
            </div>
            <span
              className={`${styles.andonLamp} ${styles[`andonLamp_${andonTone}`]}`}
              title={badge.label}
              aria-label={badge.label}
            />
          </div>
          <div className={styles.andonGrid}>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('moonshot.heartbeat_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('moonshot.heartbeat_interval')}
                value={String(status?.heartbeat?.intervalSeconds ?? 15)}
                options={heartbeatOptions}
                disabled={controlsDisabled}
                onChange={(value) => void updateConfig({ heartbeatSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('moonshot.heartbeat_last')}</span>
              <span className={styles.metaValue}>
                {formatTime(status?.heartbeat?.lastAt, i18n.language)}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('moonshot.heartbeat_result')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.ok
                  ? t('moonshot.andon_ok')
                  : status?.heartbeat?.lastError || t('common.no')}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('moonshot.token_ping')}</span>
              <ToggleSwitch
                checked={Boolean(status?.heartbeat?.tokenPingEnabled)}
                onChange={(value) => void updateConfig({ tokenPingEnabled: value })}
                disabled={controlsDisabled}
                ariaLabel={t('moonshot.token_ping')}
                label={
                  status?.heartbeat?.tokenPingEnabled ? t('moonshot.on') : t('moonshot.off')
                }
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('moonshot.token_ping_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('moonshot.token_ping_interval')}
                value={String(status?.heartbeat?.tokenPingSeconds ?? 300)}
                options={TOKEN_PING_OPTIONS}
                disabled={controlsDisabled || !status?.heartbeat?.tokenPingEnabled}
                onChange={(value) => void updateConfig({ tokenPingSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('moonshot.token_ping_last')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.tokenPingEnabled
                  ? status.heartbeat.lastTokenPingOk == null
                    ? '—'
                    : status.heartbeat.lastTokenPingOk
                      ? t('moonshot.token_ping_ok', {
                          tokens: status.heartbeat.lastTokenPingTokens ?? '?',
                        })
                      : status.heartbeat.lastTokenPingError || t('common.error')
                  : t('moonshot.token_ping_off_hint')}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.pid')}</span>
            <span className={styles.metaValue}>{status?.pid ?? '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.started_at')}</span>
            <span className={styles.metaValue}>
              {formatTime(status?.startedAt, i18n.language)}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.session_model')}</span>
            <Select
              size="sm"
              ariaLabel={t('moonshot.session_model')}
              value={status?.sessionModel ?? 'kimi-k3'}
              options={kimiOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ sessionModel: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.session_effort')}</span>
            <Select
              size="sm"
              ariaLabel={t('moonshot.session_effort')}
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
              <div className={styles.restartTitle}>{t('moonshot.restart_needed_title')}</div>
              <div className={styles.restartHint}>{t('moonshot.restart_needed_hint')}</div>
            </div>
            <Button type="button" onClick={() => void restartSession()} disabled={controlsDisabled}>
              {t('moonshot.restart')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title={t('moonshot.cursor_title')}>
        <p className={styles.lead}>{t('moonshot.cursor_description')}</p>
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.cursor_base_url')}</span>
            <span className={styles.metaValue}>
              {status?.cursorRouting?.baseUrlHint || `${status?.cpaBaseUrl || 'http://127.0.0.1:8317'}/v1`}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.cursor_api_key')}</span>
            <span className={styles.metaValue}>
              {status?.cursorRouting?.apiKeyHint || 'CHANGE_ME_LOCAL_SECRET'}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.cursor_model')}</span>
            <span className={styles.metaValue}>
              {status?.cursorRouting?.model || status?.sessionModel || 'kimi-k3'}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('moonshot.cursor_status')}</span>
            <span className={styles.metaValue}>
              {status?.cursorRouting?.ok
                ? status.cursorRouting.applied
                  ? t('moonshot.cursor_status_applied')
                  : t('moonshot.cursor_status_ready')
                : status?.cursorRouting?.error || t('moonshot.cursor_status_idle')}
            </span>
          </div>
        </div>
        <ol className={styles.steps}>
          <li>{t('moonshot.cursor_step_1')}</li>
          <li>{t('moonshot.cursor_step_2')}</li>
          <li>{t('moonshot.cursor_step_3')}</li>
        </ol>
        <div className={styles.restartBanner}>
          <div>
            <div className={styles.restartTitle}>{t('moonshot.cursor_apply_title')}</div>
            <div className={styles.restartHint}>{t('moonshot.cursor_apply_hint')}</div>
          </div>
          <Button
            type="button"
            onClick={() => void applyCursorRouting()}
            disabled={controlsDisabled}
          >
            {t('moonshot.cursor_apply')}
          </Button>
        </div>
      </Card>

      <Card title={t('moonshot.readiness_title')}>
        {!available ? (
          <p className={styles.lead}>{t('moonshot.worker_offline_hint')}</p>
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

      <Card title={t('moonshot.how_title')}>
        <ol className={styles.steps}>
          <li>{t('moonshot.how_1')}</li>
          <li>{t('moonshot.how_2')}</li>
          <li>{t('moonshot.how_3')}</li>
        </ol>
      </Card>
    </div>
  );
}
