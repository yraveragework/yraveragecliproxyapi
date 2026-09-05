/**
 * Lightweight FabSol andon for the sidebar (proxy + session liveness).
 * Uses the local worker /status HTTP probe — 0 model tokens.
 */

import { useEffect, useState } from 'react';
import { fabSolApi, type FabSolStatus } from '@/services/api';

export type FabSolAndonTone = 'offline' | 'down' | 'idle' | 'ok';

export function resolveFabSolAndon(status: FabSolStatus | null, available: boolean): FabSolAndonTone {
  if (!available || !status) return 'offline';
  if (!status.proxyOk || status.heartbeat?.ok === false) return 'down';
  if (!status.running) return 'idle';
  return 'ok';
}

export function useFabSolAndon(pollSeconds = 10) {
  const [tone, setTone] = useState<FabSolAndonTone>('offline');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ms = Math.min(60000, Math.max(3000, pollSeconds * 1000));

    const tick = async () => {
      try {
        const status = await fabSolApi.getStatus();
        if (cancelled) return;
        setAvailable(true);
        setTone(resolveFabSolAndon(status, true));
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
