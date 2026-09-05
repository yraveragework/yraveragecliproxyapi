/**
 * Global Claude 5h auto-start toggle for the sidebar Operate group.
 */

import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useClaudeAutostart } from './useClaudeAutostart';

interface ClaudeAutostartSidebarToggleProps {
  showLabel: boolean;
}

export function ClaudeAutostartSidebarToggle({ showLabel }: ClaudeAutostartSidebarToggleProps) {
  const { t } = useTranslation();
  const {
    settings,
    available,
    loading,
    saving,
    setGlobalEnabled,
  } = useClaudeAutostart(true);

  const label = t('claude_quota.autostart_global_label');
  const title = available
    ? t('claude_quota.autostart_global_hint')
    : t('claude_quota.autostart_worker_offline');

  return (
    <div className="sidebar-autostart" title={title}>
      <ToggleSwitch
        checked={Boolean(settings?.globalEnabled)}
        onChange={(value) => void setGlobalEnabled(value)}
        disabled={!available || loading || saving}
        label={showLabel ? label : undefined}
        ariaLabel={label}
      />
    </div>
  );
}
