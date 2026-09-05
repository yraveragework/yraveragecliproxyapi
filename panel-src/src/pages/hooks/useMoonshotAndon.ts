/**
 * Lightweight Moonshot andon for the sidebar (proxy + session liveness).
 */

import { useEffect, useState } from 'react';
import { moonshotApi, type MoonshotStatus } from '@/services/api';

export type MoonshotAndonTone = 'offline' | 'down' | 'idle' | 'ok';

export function resolveMoonshotAndon(
  status: MoonshotStatus | null,
  available: boolean
): MoonshotAndonTone {
  if (!available || !status) return 'offline';
  if (!status.proxyOk || status.heartbeat?.ok === false) return 'down';
  if (!status.running) return 'idle';
  return 'ok';
}

export function useMoonshotAndon(pollSeconds = 10) {
  const [tone, setTone] = useState<MoonshotAndonTone>('offline');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ms = Math.min(60000, Math.max(3000, pollSeconds * 1000));

    const tick = async () => {
      try {
        const status = await moonshotApi.getStatus();
        if (cancelled) return;
        setAvailable(true);
        setTone(resolveMoonshotAndon(status, true));
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
