import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useFabKim } from '@/pages/hooks/useFabKim';
import { resolveFabKimAndon } from '@/pages/hooks/useFabKimAndon';
import styles from './FabKimPage.module.scss';

const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_ORCHESTRATORS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];
const FALLBACK_WORKERS = [
  'kimi-k3',
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2',
  'kimi-k2-thinking',
];
const HEARTBEAT_OPTIONS = [
  { value: '0', labelKey: 'fabkim.heartbeat_off' as const },
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

export function FabKimPage() {
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
  } = useFabKim();

  const andonTone = useMemo(
    () => resolveFabKimAndon(status, available),
    [available, status]
  );

  const badge = useMemo(() => {
    if (andonTone === 'offline') {
      return { type: 'warning' as const, label: t('fabkim.status_worker_offline') };
    }
    if (andonTone === 'down') {
      return { type: 'error' as const, label: t('fabkim.andon_down') };
    }
    if (andonTone === 'ok') {
      return { type: 'success' as const, label: t('fabkim.status_running') };
    }
    return { type: 'muted' as const, label: t('fabkim.status_stopped') };
  }, [andonTone, t]);

  const heartbeatOptions = useMemo(
    () =>
      HEARTBEAT_OPTIONS.map((opt) => ({
        value: opt.value,
        label: 'labelKey' in opt && opt.labelKey ? t(opt.labelKey) : (opt.label as string),
      })),
    [t]
  );

  const orchestratorOptions = useMemo(
    () =>
      toOptions(
        ensureSelected(status?.orchestratorModels, status?.orchestratorModel, FALLBACK_ORCHESTRATORS)
      ),
    [status?.orchestratorModel, status?.orchestratorModels]
  );

  const workerOptions = useMemo(
    () => toOptions(ensureSelected(status?.workerModels, status?.workerModel, FALLBACK_WORKERS)),
    [status?.workerModel, status?.workerModels]
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
        label: t('fabkim.check_proxy'),
        detail: status.proxyOk ? status.cpaBaseUrl : status.proxyError || t('common.error'),
      },
      {
        ok: status.claudeAvailable,
        label: t('fabkim.check_claude'),
        detail: status.claudeAvailable
          ? status.claudePath || t('common.yes')
          : t('fabkim.claude_missing'),
      },
      {
        ok: status.hasOrchestratorModel,
        label: t('fabkim.check_orchestrator'),
        detail: `${status.orchestratorModel} @ ${status.orchestratorEffort || 'high'}`,
      },
      {
        ok: status.hasWorkerModel,
        label: t('fabkim.check_worker'),
        detail: `${status.workerModel} @ ${status.workerEffort}`,
      },
    ];
  }, [available, status, t]);

  const controlsDisabled = !available || saving || loading;

  return (
    <div className={styles.page}>
      <Card
        title={t('fabkim.title')}
        extra={
          <div className={styles.headerExtra}>
            <span className={`status-badge ${badge.type}`}>{badge.label}</span>
            <Button type="button" onClick={() => void refresh()} disabled={loading || saving}>
              {t('common.refresh')}
            </Button>
          </div>
        }
      >
        <p className={styles.lead}>{t('fabkim.description')}</p>

        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('fabkim.toggle_label')}</div>
            <div className={styles.controlHint}>
              {available ? t('fabkim.toggle_hint') : t('fabkim.worker_offline_hint')}
            </div>
          </div>
          <ToggleSwitch
            checked={Boolean(status?.running)}
            onChange={(value) => void setEnabled(value)}
            disabled={!available || saving || loading}
            ariaLabel={t('fabkim.toggle_label')}
            label={status?.running ? t('fabkim.on') : t('fabkim.off')}
          />
        </div>

        {status?.lastError ? (
          <div className={styles.errorBox}>{status.lastError}</div>
        ) : null}

        <div className={styles.andonSection}>
          <div className={styles.andonHeader}>
            <div>
              <div className={styles.andonTitle}>{t('fabkim.andon_title')}</div>
              <div className={styles.andonHint}>{t('fabkim.andon_hint')}</div>
            </div>
            <span
              className={`${styles.andonLamp} ${styles[`andonLamp_${andonTone}`]}`}
              title={badge.label}
              aria-label={badge.label}
            />
          </div>
          <div className={styles.andonGrid}>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabkim.heartbeat_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('fabkim.heartbeat_interval')}
                value={String(status?.heartbeat?.intervalSeconds ?? 15)}
                options={heartbeatOptions}
                disabled={controlsDisabled}
                onChange={(value) => void updateConfig({ heartbeatSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabkim.heartbeat_last')}</span>
              <span className={styles.metaValue}>
                {formatTime(status?.heartbeat?.lastAt, i18n.language)}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabkim.heartbeat_result')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.ok
                  ? t('fabkim.andon_ok')
                  : status?.heartbeat?.lastError || t('common.no')}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabkim.token_ping')}</span>
              <ToggleSwitch
                checked={Boolean(status?.heartbeat?.tokenPingEnabled)}
                onChange={(value) => void updateConfig({ tokenPingEnabled: value })}
                disabled={controlsDisabled}
                ariaLabel={t('fabkim.token_ping')}
                label={
                  status?.heartbeat?.tokenPingEnabled ? t('fabkim.on') : t('fabkim.off')
                }
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabkim.token_ping_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('fabkim.token_ping_interval')}
                value={String(status?.heartbeat?.tokenPingSeconds ?? 300)}
                options={TOKEN_PING_OPTIONS}
                disabled={controlsDisabled || !status?.heartbeat?.tokenPingEnabled}
                onChange={(value) => void updateConfig({ tokenPingSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabkim.token_ping_last')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.tokenPingEnabled
                  ? status.heartbeat.lastTokenPingOk == null
                    ? '—'
                    : status.heartbeat.lastTokenPingOk
                      ? t('fabkim.token_ping_ok', {
                          tokens: status.heartbeat.lastTokenPingTokens ?? '?',
                        })
                      : status.heartbeat.lastTokenPingError || t('common.error')
                  : t('fabkim.token_ping_off_hint')}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabkim.pid')}</span>
            <span className={styles.metaValue}>{status?.pid ?? '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabkim.started_at')}</span>
            <span className={styles.metaValue}>
              {formatTime(status?.startedAt, i18n.language)}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabkim.orchestrator')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabkim.orchestrator')}
              value={status?.orchestratorModel ?? 'claude-fable-5'}
              options={orchestratorOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ orchestratorModel: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabkim.orchestrator_effort')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabkim.orchestrator_effort')}
              value={status?.orchestratorEffort ?? 'high'}
              options={effortOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ orchestratorEffort: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabkim.worker')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabkim.worker')}
              value={status?.workerModel ?? 'kimi-k3'}
              options={workerOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ workerModel: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabkim.worker_effort')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabkim.worker_effort')}
              value={status?.workerEffort ?? 'high'}
              options={effortOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ workerEffort: value })}
            />
          </div>
        </div>

        {status?.running ? (
          <div className={styles.restartBanner}>
            <div>
              <div className={styles.restartTitle}>{t('fabkim.restart_needed_title')}</div>
              <div className={styles.restartHint}>{t('fabkim.restart_needed_hint')}</div>
            </div>
            <Button
              type="button"
              onClick={() => void restartSession()}
              disabled={controlsDisabled}
            >
              {t('fabkim.restart')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title={t('fabkim.readiness_title')}>
        {!available ? (
          <p className={styles.lead}>{t('fabkim.worker_offline_hint')}</p>
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

      <Card title={t('fabkim.how_title')}>
        <ol className={styles.steps}>
          <li>{t('fabkim.how_1')}</li>
          <li>{t('fabkim.how_2')}</li>
          <li>{t('fabkim.how_3')}</li>
        </ol>
      </Card>
    </div>
  );
}
