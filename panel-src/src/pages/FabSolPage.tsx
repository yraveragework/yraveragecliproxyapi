import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useFabSol } from '@/pages/hooks/useFabSol';
import { resolveFabSolAndon } from '@/pages/hooks/useFabSolAndon';
import styles from './FabSolPage.module.scss';

const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const FALLBACK_ORCHESTRATORS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];
const FALLBACK_WORKERS = ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2'];
const HEARTBEAT_OPTIONS = [
  { value: '0', labelKey: 'fabsol.heartbeat_off' as const },
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

export function FabSolPage() {
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
  } = useFabSol();

  const andonTone = useMemo(
    () => resolveFabSolAndon(status, available),
    [available, status]
  );

  const badge = useMemo(() => {
    if (andonTone === 'offline') {
      return { type: 'warning' as const, label: t('fabsol.status_worker_offline') };
    }
    if (andonTone === 'down') {
      return { type: 'error' as const, label: t('fabsol.andon_down') };
    }
    if (andonTone === 'ok') {
      return { type: 'success' as const, label: t('fabsol.status_running') };
    }
    return { type: 'muted' as const, label: t('fabsol.status_stopped') };
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
        label: t('fabsol.check_proxy'),
        detail: status.proxyOk ? status.cpaBaseUrl : status.proxyError || t('common.error'),
      },
      {
        ok: status.claudeAvailable,
        label: t('fabsol.check_claude'),
        detail: status.claudeAvailable
          ? status.claudePath || t('common.yes')
          : t('fabsol.claude_missing'),
      },
      {
        ok: status.hasOrchestratorModel,
        label: t('fabsol.check_orchestrator'),
        detail: `${status.orchestratorModel} @ ${status.orchestratorEffort || 'high'}`,
      },
      {
        ok: status.hasWorkerModel,
        label: t('fabsol.check_worker'),
        detail: `${status.workerModel} @ ${status.workerEffort}`,
      },
    ];
  }, [available, status, t]);

  const controlsDisabled = !available || saving || loading;

  return (
    <div className={styles.page}>
      <Card
        title={t('fabsol.title')}
        extra={
          <div className={styles.headerExtra}>
            <span className={`status-badge ${badge.type}`}>{badge.label}</span>
            <Button type="button" onClick={() => void refresh()} disabled={loading || saving}>
              {t('common.refresh')}
            </Button>
          </div>
        }
      >
        <p className={styles.lead}>{t('fabsol.description')}</p>

        <div className={styles.controlRow}>
          <div>
            <div className={styles.controlLabel}>{t('fabsol.toggle_label')}</div>
            <div className={styles.controlHint}>
              {available
                ? t('fabsol.toggle_hint')
                : t('fabsol.worker_offline_hint')}
            </div>
          </div>
          <ToggleSwitch
            checked={Boolean(status?.running)}
            onChange={(value) => void setEnabled(value)}
            disabled={!available || saving || loading}
            ariaLabel={t('fabsol.toggle_label')}
            label={status?.running ? t('fabsol.on') : t('fabsol.off')}
          />
        </div>

        {status?.lastError ? (
          <div className={styles.errorBox}>{status.lastError}</div>
        ) : null}

        <div className={styles.andonSection}>
          <div className={styles.andonHeader}>
            <div>
              <div className={styles.andonTitle}>{t('fabsol.andon_title')}</div>
              <div className={styles.andonHint}>{t('fabsol.andon_hint')}</div>
            </div>
            <span
              className={`${styles.andonLamp} ${styles[`andonLamp_${andonTone}`]}`}
              title={badge.label}
              aria-label={badge.label}
            />
          </div>
          <div className={styles.andonGrid}>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabsol.heartbeat_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('fabsol.heartbeat_interval')}
                value={String(status?.heartbeat?.intervalSeconds ?? 15)}
                options={heartbeatOptions}
                disabled={controlsDisabled}
                onChange={(value) => void updateConfig({ heartbeatSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabsol.heartbeat_last')}</span>
              <span className={styles.metaValue}>
                {formatTime(status?.heartbeat?.lastAt, i18n.language)}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabsol.heartbeat_result')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.ok
                  ? t('fabsol.andon_ok')
                  : status?.heartbeat?.lastError || t('common.no')}
              </span>
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabsol.token_ping')}</span>
              <ToggleSwitch
                checked={Boolean(status?.heartbeat?.tokenPingEnabled)}
                onChange={(value) => void updateConfig({ tokenPingEnabled: value })}
                disabled={controlsDisabled}
                ariaLabel={t('fabsol.token_ping')}
                label={
                  status?.heartbeat?.tokenPingEnabled
                    ? t('fabsol.on')
                    : t('fabsol.off')
                }
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabsol.token_ping_interval')}</span>
              <Select
                size="sm"
                ariaLabel={t('fabsol.token_ping_interval')}
                value={String(status?.heartbeat?.tokenPingSeconds ?? 300)}
                options={TOKEN_PING_OPTIONS}
                disabled={controlsDisabled || !status?.heartbeat?.tokenPingEnabled}
                onChange={(value) => void updateConfig({ tokenPingSeconds: Number(value) })}
              />
            </div>
            <div className={styles.andonItem}>
              <span className={styles.metaLabel}>{t('fabsol.token_ping_last')}</span>
              <span className={styles.metaValue}>
                {status?.heartbeat?.tokenPingEnabled
                  ? status.heartbeat.lastTokenPingOk == null
                    ? '—'
                    : status.heartbeat.lastTokenPingOk
                      ? t('fabsol.token_ping_ok', {
                          tokens: status.heartbeat.lastTokenPingTokens ?? '?',
                        })
                      : status.heartbeat.lastTokenPingError || t('common.error')
                  : t('fabsol.token_ping_off_hint')}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabsol.pid')}</span>
            <span className={styles.metaValue}>{status?.pid ?? '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabsol.started_at')}</span>
            <span className={styles.metaValue}>
              {formatTime(status?.startedAt, i18n.language)}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabsol.orchestrator')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabsol.orchestrator')}
              value={status?.orchestratorModel ?? 'claude-fable-5'}
              options={orchestratorOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ orchestratorModel: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabsol.orchestrator_effort')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabsol.orchestrator_effort')}
              value={status?.orchestratorEffort ?? 'high'}
              options={effortOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ orchestratorEffort: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabsol.worker')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabsol.worker')}
              value={status?.workerModel ?? 'gpt-5.6-sol'}
              options={workerOptions}
              disabled={controlsDisabled}
              onChange={(value) => void updateConfig({ workerModel: value })}
            />
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t('fabsol.worker_effort')}</span>
            <Select
              size="sm"
              ariaLabel={t('fabsol.worker_effort')}
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
              <div className={styles.restartTitle}>{t('fabsol.restart_needed_title')}</div>
              <div className={styles.restartHint}>{t('fabsol.restart_needed_hint')}</div>
            </div>
            <Button
              type="button"
              onClick={() => void restartSession()}
              disabled={controlsDisabled}
            >
              {t('fabsol.restart')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title={t('fabsol.readiness_title')}>
        {!available ? (
          <p className={styles.lead}>{t('fabsol.worker_offline_hint')}</p>
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

      <Card title={t('fabsol.how_title')}>
        <ol className={styles.steps}>
          <li>{t('fabsol.how_1')}</li>
          <li>{t('fabsol.how_2')}</li>
          <li>{t('fabsol.how_3')}</li>
        </ol>
      </Card>
    </div>
  );
}
