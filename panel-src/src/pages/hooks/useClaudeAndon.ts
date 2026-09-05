/**
 * Lightweight Claude-only andon for the sidebar (CLI + session liveness).
 */

import { useEffect, useState } from 'react';
import { claudeSessionApi, type ClaudeStatus } from '@/services/api';

export type ClaudeAndonTone = 'offline' | 'down' | 'idle' | 'ok';

export function resolveClaudeAndon(
  status: ClaudeStatus | null,
  available: boolean
): ClaudeAndonTone {
  if (!available || !status) return 'offline';
  if (!status.claudeAvailable || status.heartbeat?.ok === false) return 'down';
  if (!status.running) return 'idle';
  return 'ok';
}

export function useClaudeAndon(pollSeconds = 10) {
  const [tone, setTone] = useState<ClaudeAndonTone>('offline');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ms = Math.min(60000, Math.max(3000, pollSeconds * 1000));

    const tick = async () => {
      try {
        const status = await claudeSessionApi.getStatus();
        if (cancelled) return;
        setAvailable(true);
        setTone(resolveClaudeAndon(status, true));
      } catch {
        if (cancelled) return;
        setAvailable(false);
        setTone('offline');
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, ms);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollSeconds]);

  return { tone, available };
}
