import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconKey,
  IconBot,
  IconFileText,
  IconSatellite,
  IconSidebarQuickStart,
  IconDownload,
  IconExternalLink,
  IconRefreshCw,
} from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useModelsStore,
  useNotificationStore,
} from '@/stores';
import {
  authFilesApi,
  fetchLatestCliProxyRelease,
  localSettingsApi,
  type LatestCliProxyRelease,
} from '@/services/api';
import { getTypeLabel, normalizeProviderKey } from '@/features/authFiles/constants';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { hasApiKeyFunConfig } from '@/features/providers/sponsor';
import { formatDateValue } from '@/utils/format';
import { getDashboardModelsStatValue } from '@/utils/dashboard';
import { compareVersions } from '@/utils/versionCompare';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
  sublabel?: string;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function isWorkerOfflineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    error instanceof TypeError ||
    /failed to fetch|network ?error|networkerror|load failed|connection refused/i.test(message)
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const { showNotification, showConfirmation } = useNotificationStore();

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [authFilesCount, setAuthFilesCount] = useState<number | null>(null);
  const [authLoginBreakdown, setAuthLoginBreakdown] = useState('');
  const [authFilesLoading, setAuthFilesLoading] = useState(false);
  const [latestRelease, setLatestRelease] = useState<LatestCliProxyRelease | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const updateCheckInFlightRef = useRef(false);
  const autoCheckedVersionRef = useRef<string | null>(null);

  // Time-of-day state for dynamic greeting
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // Update time every 60 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
      setCurrentTime(new Date());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const handleCheckForUpdates = useCallback(
    async (silent = false) => {
      if (!serverVersion || updateCheckInFlightRef.current) return;

      updateCheckInFlightRef.current = true;
      setCheckingUpdate(true);
      try {
        const release = await fetchLatestCliProxyRelease();
        const comparison = compareVersions(release.tag_name, serverVersion);
        if (comparison === null) {
          throw new Error('Unable to compare the current and latest versions');
        }

        if (comparison > 0) {
          setLatestRelease(release);
          showNotification(
            t('dashboard.update_available', { version: release.tag_name }),
            'warning'
          );
        } else {
          setLatestRelease(null);
          if (!silent) {
            showNotification(t('dashboard.already_latest'), 'success');
          }
        }
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : String(error);
          showNotification(t('dashboard.update_check_failed', { message }), 'error');
        }
      } finally {
        updateCheckInFlightRef.current = false;
        setCheckingUpdate(false);
      }
    },
    [serverVersion, showNotification, t]
  );

  useEffect(() => {
    if (connectionStatus !== 'connected' || !serverVersion) return;
    if (autoCheckedVersionRef.current === serverVersion) return;
    autoCheckedVersionRef.current = serverVersion;
    void handleCheckForUpdates(true);
  }, [connectionStatus, handleCheckForUpdates, serverVersion]);

  const handleApplyUpdate = useCallback(() => {
    if (!serverVersion || !latestRelease || applyingUpdate) return;

    showConfirmation({
      title: t('dashboard.update_confirm_title'),
      message: t('dashboard.update_confirm_message'),
      confirmText: t('dashboard.download_install'),
      variant: 'primary',
      onConfirm: async () => {
        setApplyingUpdate(true);
        try {
          const result = await localSettingsApi.applyUpdate({
            currentVersion: serverVersion,
            tagName: latestRelease.tag_name,
            restart: true,
          });
          setLatestRelease(null);
          showNotification(
            t('dashboard.update_success', { version: result.newVersion || latestRelease.tag_name }),
            'success',
            8000
          );
        } catch (error) {
          if (isWorkerOfflineError(error)) {
            showNotification(t('dashboard.update_worker_offline'), 'error', 10000);
          } else {
            const message = error instanceof Error ? error.message : String(error);
            showNotification(t('dashboard.update_failed', { message }), 'error', 10000);
          }
        } finally {
          setApplyingUpdate(false);
        }
      },
    });
  }, [applyingUpdate, latestRelease, serverVersion, showConfirmation, showNotification, t]);

  const resolveApiKeysForModels = useApiKeysForModels();

  const fetchModels = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) {
      return;
    }

    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      await fetchModelsFromStore(apiBase, primaryKey);
    } catch {
      // Ignore model fetch errors on dashboard
    }
  }, [connectionStatus, apiBase, resolveApiKeysForModels, fetchModelsFromStore]);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;

    const loadAuthFiles = async () => {
      setAuthFilesLoading(true);
      try {
        const res = await authFilesApi.list();
        const files = Array.isArray(res.files) ? res.files : [];
        const counts: Record<string, number> = {};
        files.forEach((file) => {
          const type = normalizeProviderKey(String(file.type || file.provider || 'unknown'));
          counts[type] = (counts[type] || 0) + 1;
        });
        const breakdown = Object.entries(counts)
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([type, count]) => `${getTypeLabel(t, type)}:${count}`)
          .join(' ');
        if (!cancelled) {
          setAuthFilesCount(files.length);
          setAuthLoginBreakdown(breakdown);
        }
      } catch {
        if (!cancelled) {
          setAuthFilesCount(null);
          setAuthLoginBreakdown('');
        }
      } finally {
        setAuthFilesLoading(false);
      }
    };

    // 提供商/密钥统计直接来自 config store；这里只需保证配置已加载并取认证文件数。
    fetchConfig().catch(() => undefined);
    fetchModels();
    void loadAuthFiles();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, fetchConfig, fetchModels, t]);

  const configLoading = !config;
  const providerStats = config
    ? {
        gemini: config.geminiApiKeys?.length ?? 0,
        codex: config.codexApiKeys?.length ?? 0,
        xai: config.xaiApiKeys?.length ?? 0,
        claude: config.claudeApiKeys?.length ?? 0,
        vertex: config.vertexApiKeys?.length ?? 0,
        openai: config.openaiCompatibility?.length ?? 0,
      }
    : null;
  const totalProviderKeys = providerStats
    ? Object.values(providerStats).reduce((sum, count) => sum + count, 0)
    : 0;
  const isApiKeyFunConfigured = hasApiKeyFunConfig(config);

  const quickStats: QuickStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: config ? (config.apiKeys?.length ?? 0) : '-',
      icon: <IconKey size={24} />,
      path: '/config',
      loading: configLoading,
      sublabel: t('nav.config_management'),
    },
    {
      label: t('nav.ai_providers'),
      value: providerStats ? totalProviderKeys : '-',
      icon: <IconBot size={24} />,
      path: '/ai-providers',
      loading: configLoading,
      sublabel: providerStats
        ? t('dashboard.provider_keys_detail', {
            gemini: providerStats.gemini,
            codex: providerStats.codex,
            xai: providerStats.xai,
            claude: providerStats.claude,
            vertex: providerStats.vertex,
            openai: providerStats.openai,
          })
        : undefined,
    },
    {
      label: t('dashboard.logged_in_accounts'),
      value: authFilesCount ?? '-',
      icon: <IconFileText size={24} />,
      path: '/oauth',
      loading: authFilesLoading && authFilesCount === null,
      sublabel: authLoginBreakdown || t('dashboard.oauth_credentials'),
    },
    {
      label: t('dashboard.available_models'),
      value: getDashboardModelsStatValue(models.length, modelsLoading, modelsError),
      icon: <IconSatellite size={24} />,
      path: '/system',
      loading: modelsLoading,
      sublabel: t('dashboard.available_models_desc'),
    },
    ...(!isApiKeyFunConfigured
      ? [
          {
            label: t('dashboard.quick_start_card'),
            value: t('dashboard.quick_start_entry'),
            icon: <IconSidebarQuickStart size={24} />,
            path: '/quick-start',
            sublabel: t('dashboard.quick_start_entry_desc'),
          },
        ]
      : []),
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '-'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;
  const routingStrategyBadgeClass = !routingStrategyRaw
    ? styles.configBadgeUnknown
    : routingStrategyRaw === 'round-robin'
      ? styles.configBadgeRoundRobin
      : routingStrategyRaw === 'fill-first'
        ? styles.configBadgeFillFirst
        : styles.configBadgeUnknown;

  // Derived time-based values
  const greetingKey = `dashboard.greeting_${timeOfDay}`;
  const caringKey = `dashboard.caring_${timeOfDay}`;

  const formattedDate = currentTime.toLocaleDateString(i18n.language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = currentTime.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const serverBuildDateDisplay = formatDateValue(serverBuildDate, i18n.language);
  const latestVersionDisplay = latestRelease?.tag_name.trim().replace(/^[vV]+/, '') ?? '';
  const latestPublishedDate = formatDateValue(latestRelease?.published_at, i18n.language);
  const releaseNotes = latestRelease?.body?.trim() || latestRelease?.name?.trim() || '';
  const releaseNotesPreview =
    releaseNotes.length > 900 ? `${releaseNotes.slice(0, 900).trimEnd()}…` : releaseNotes;

  return (
    <div className={styles.dashboard}>
      {/* Decorative background orbs */}
      <div className={styles.backgroundOrbs} aria-hidden="true">
        <div className={styles.orb1} />
        <div className={styles.orb2} />
      </div>

      {/* Hero welcome section */}
      <section className={styles.hero}>
        <span className={styles.heroWatermark} aria-hidden="true">
          OVERVIEW
        </span>
        <div className={styles.heroContent}>
          <span className={styles.heroGreeting}>{t(greetingKey)}</span>
          <h1 className={styles.heroTitle}>{t('dashboard.welcome_back')}</h1>
          <p className={styles.heroCaring}>{t(caringKey)}</p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.dateTimeBlock}>
            <span className={styles.time}>{formattedTime}</span>
            <span className={styles.date}>{formattedDate}</span>
          </div>
          <div className={styles.connectionPill}>
            <span
              className={`${styles.statusDot} ${
                connectionStatus === 'connected'
                  ? styles.connected
                  : connectionStatus === 'connecting'
                    ? styles.connecting
                    : styles.disconnected
              }`}
            />
            <span className={styles.pillText}>
              {serverVersion
                ? `v${serverVersion.trim().replace(/^[vV]+/, '')}`
                : t(
                    connectionStatus === 'connected'
                      ? 'common.connected'
                      : connectionStatus === 'connecting'
                        ? 'common.connecting'
                        : 'common.disconnected'
                  )}
            </span>
            {latestRelease && (
              <span className={styles.updateBadge}>{t('dashboard.update_badge')}</span>
            )}
          </div>
          {serverBuildDateDisplay && (
            <span className={styles.buildDate}>{serverBuildDateDisplay}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={styles.updateCheckButton}
            loading={checkingUpdate}
            disabled={!serverVersion || connectionStatus !== 'connected'}
            onClick={() => void handleCheckForUpdates(false)}
          >
            <IconRefreshCw size={14} />
            {t(checkingUpdate ? 'dashboard.checking_updates' : 'dashboard.check_updates')}
          </Button>
        </div>
      </section>

      {latestRelease && (
        <section className={styles.updatePanel} aria-live="polite">
          <div className={styles.updatePanelHeader}>
            <div>
              <span className={styles.updatePanelEyebrow}>{t('dashboard.update_badge')}</span>
              <h2 className={styles.updatePanelTitle}>
                {t('dashboard.update_available', { version: `v${latestVersionDisplay}` })}
              </h2>
              {latestPublishedDate && (
                <span className={styles.updatePublishedDate}>{latestPublishedDate}</span>
              )}
            </div>
            <div className={styles.updateActions}>
              <Button loading={applyingUpdate} onClick={handleApplyUpdate}>
                <span className={styles.updateButtonContent}>
                  <IconDownload size={16} />
                  {t('dashboard.download_install')}
                </span>
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  window.open(latestRelease.html_url, '_blank', 'noopener,noreferrer')
                }
              >
                <span className={styles.updateButtonContent}>
                  <IconExternalLink size={16} />
                  {t('dashboard.open_release')}
                </span>
              </Button>
              <Button
                variant="ghost"
                disabled={applyingUpdate}
                onClick={() => setLatestRelease(null)}
              >
                {t('dashboard.dismiss_update')}
              </Button>
            </div>
          </div>
          <div className={styles.releaseNotes}>
            <h3>{t('dashboard.whats_new')}</h3>
            <p>{releaseNotesPreview}</p>
          </div>
        </section>
      )}

      {/* Bento stats grid */}
      <section className={styles.statsSection}>
        <h2 className={styles.sectionHeading}>{t('dashboard.system_overview')}</h2>
        <div className={styles.bentoGrid}>
          {quickStats.map((stat, index) => (
            <Link
              key={stat.path}
              to={stat.path}
              className={`${styles.bentoCard} ${index === 0 ? styles.bentoLarge : ''}`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className={styles.bentoIcon}>{stat.icon}</div>
              <div className={styles.bentoContent}>
                <span className={styles.bentoValue}>{stat.loading ? '...' : stat.value}</span>
                <span className={styles.bentoLabel}>{stat.label}</span>
                {stat.sublabel && !stat.loading && (
                  <span className={styles.bentoSublabel}>{stat.sublabel}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Config pills section */}
      {config && (
        <section className={styles.configSection}>
          <h2 className={styles.sectionHeading}>{t('dashboard.current_config')}</h2>
          <div className={styles.configPillGrid}>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.debug_enable')}</span>
              <span
                className={`${styles.configPillValue} ${config.debug ? styles.on : styles.off}`}
              >
                {config.debug ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>
                {t('basic_settings.logging_to_file_enable')}
              </span>
              <span
                className={`${styles.configPillValue} ${config.loggingToFile ? styles.on : styles.off}`}
              >
                {config.loggingToFile ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>
                {t('basic_settings.retry_count_label')}
              </span>
              <span className={styles.configPillValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.ws_auth_enable')}</span>
              <span
                className={`${styles.configPillValue} ${config.wsAuth ? styles.on : styles.off}`}
              >
                {config.wsAuth ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('dashboard.routing_strategy')}</span>
              <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
                {routingStrategyDisplay}
              </span>
            </div>
            {config.proxyUrl && (
              <div className={`${styles.configPill} ${styles.configPillWide}`}>
                <span className={styles.configPillLabel}>
                  {t('basic_settings.proxy_url_label')}
                </span>
                <span className={styles.configPillMono}>{config.proxyUrl}</span>
              </div>
            )}
          </div>
          <Link to="/config" className={styles.viewMoreLink}>
            {t('dashboard.edit_settings')} →
          </Link>
        </section>
      )}
    </div>
  );
}
