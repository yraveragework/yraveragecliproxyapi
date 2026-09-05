/**
 * Loads Claude (orchestrator) + worker-provider quota for the FabSol page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  useQuotaLoader,
} from '@/components/quota';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState, KimiQuotaState } from '@/types';
import { useAuthStore } from '@/stores';

export type FabSolWorkerProvider = 'codex' | 'kimi';

export function resolveWorkerProvider(model: string | undefined): FabSolWorkerProvider {
  return /kimi/i.test(model || '') ? 'kimi' : 'codex';
}

export interface FabSolQuotaWindowSummary {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetLabel: string;
}

export interface FabSolAccountQuotaSummary {
  fileName: string;
  planType?: string | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  windows: FabSolQuotaWindowSummary[];
}

function remainingFromUsed(usedPercent: number | null | undefined): number | null {
  if (usedPercent == null || Number.isNaN(Number(usedPercent))) return null;
  return Math.max(0, Math.min(100, 100 - Number(usedPercent)));
}

function summarizeClaude(file: AuthFileItem, quota?: ClaudeQuotaState): FabSolAccountQuotaSummary {
  return {
    fileName: file.name,
    planType: quota?.planType,
    status: quota?.status ?? 'idle',
    error: quota?.error,
    windows: (quota?.windows || []).slice(0, 2).map((window) => ({
      id: window.id,
      label: window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetLabel: window.resetLabel,
    })),
  };
}

function summarizeCodex(file: AuthFileItem, quota?: CodexQuotaState): FabSolAccountQuotaSummary {
  return {
    fileName: file.name,
    planType: quota?.planType,
    status: quota?.status ?? 'idle',
    error: quota?.error,
    windows: (quota?.windows || []).slice(0, 2).map((window) => ({
      id: window.id,
      label: window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetLabel: window.resetLabel,
    })),
  };
}

function summarizeKimi(file: AuthFileItem, quota?: KimiQuotaState): FabSolAccountQuotaSummary {
  const rows = quota?.rows || [];
  return {
    fileName: file.name,
    status: quota?.status ?? 'idle',
    error: quota?.error,
    windows: rows.slice(0, 2).map((row, index) => {
      const used = Number(row.used);
      const limit = Number(row.limit);
      const remaining =
        Number.isFinite(used) && Number.isFinite(limit) && limit > 0
          ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
          : row.remaining != null
            ? Math.max(0, Math.min(100, Math.round(Number(row.remaining))))
            : null;
      return {
        id: row.name || `kimi-${index}`,
        label: row.title || row.name || `Quota ${index + 1}`,
        remainingPercent: remaining,
        resetLabel: row.resetHint || '—',
      };
    }),
  };
}

export function useFabSolQuota(workerModel: string | undefined) {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [workerLoading, setWorkerLoading] = useState(false);

  const workerProvider = resolveWorkerProvider(workerModel);
  const { quota: claudeQuota, loadQuota: loadClaudeQuota } = useQuotaLoader(CLAUDE_CONFIG);
  const { quota: codexQuota, loadQuota: loadCodexQuota } = useQuotaLoader(CODEX_CONFIG);
  const { quota: kimiQuota, loadQuota: loadKimiQuota } = useQuotaLoader(KIMI_CONFIG);

  const claudeFiles = useMemo(() => files.filter(CLAUDE_CONFIG.filterFn), [files]);
  const codexFiles = useMemo(() => files.filter(CODEX_CONFIG.filterFn), [files]);
  const kimiFiles = useMemo(() => files.filter(KIMI_CONFIG.filterFn), [files]);
  const workerFiles = workerProvider === 'kimi' ? kimiFiles : codexFiles;

  const refreshFiles = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesError('');
      return;
    }
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      setFiles([]);
      setFilesError(err instanceof Error ? err.message : 'Failed to load auth files');
    } finally {
      setFilesLoading(false);
    }
  }, [connectionStatus]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  useEffect(() => {
    if (!claudeFiles.length) return;
    void loadClaudeQuota(claudeFiles, setClaudeLoading);
  }, [claudeFiles, loadClaudeQuota]);

  useEffect(() => {
    if (!workerFiles.length) return;
    if (workerProvider === 'kimi') {
      void loadKimiQuota(workerFiles, setWorkerLoading);
    } else {
      void loadCodexQuota(workerFiles, setWorkerLoading);
    }
  }, [loadCodexQuota, loadKimiQuota, workerFiles, workerProvider]);

  const orchestratorAccounts = useMemo(
    () => claudeFiles.map((file) => summarizeClaude(file, claudeQuota[file.name])),
    [claudeFiles, claudeQuota]
  );

  const workerAccounts = useMemo(() => {
    if (workerProvider === 'kimi') {
      return kimiFiles.map((file) => summarizeKimi(file, kimiQuota[file.name]));
    }
    return codexFiles.map((file) => summarizeCodex(file, codexQuota[file.name]));
  }, [codexFiles, codexQuota, kimiFiles, kimiQuota, workerProvider]);

  const refreshQuota = useCallback(async () => {
    await refreshFiles();
    if (claudeFiles.length) await loadClaudeQuota(claudeFiles, setClaudeLoading);
    if (workerProvider === 'kimi') {
      if (kimiFiles.length) await loadKimiQuota(kimiFiles, setWorkerLoading);
    } else if (codexFiles.length) {
      await loadCodexQuota(codexFiles, setWorkerLoading);
    }
  }, [
    claudeFiles,
    codexFiles,
    kimiFiles,
    loadClaudeQuota,
    loadCodexQuota,
    loadKimiQuota,
    refreshFiles,
    workerProvider,
  ]);

  return {
    connectionStatus,
    filesError,
    filesLoading,
    loading: filesLoading || claudeLoading || workerLoading,
    workerProvider,
    orchestratorAccounts,
    workerAccounts,
    refreshQuota,
  };
}
