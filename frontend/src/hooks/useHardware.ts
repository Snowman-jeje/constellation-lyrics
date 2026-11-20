import { useCallback, useEffect, useState } from 'react';
import { isTauriRuntime, safeInvoke, safeListen } from '../store/tauriBridge';
import type { HardwareSnapshot } from '../types/suite';

interface BatteryManagerLike {
  level: number;
  charging: boolean;
}

export function useHardware(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    if (isTauriRuntime()) {
      const data = await safeInvoke<HardwareSnapshot>('get_hardware_snapshot');
      if (data) {
        setSnapshot(data);
        setLoading(false);
        return;
      }
    }

    // Browser graceful battery fallback if Web Battery API exists
    try {
      const nav = navigator as unknown as {
        getBattery?: () => Promise<BatteryManagerLike>;
      };
      if (typeof nav.getBattery === 'function') {
        const bat = await nav.getBattery();
        setSnapshot({
          cpu_pct: 0,
          ram_used_gb: 0,
          ram_total_gb: 0,
          net_rx_kbps: 0,
          net_tx_kbps: 0,
          battery_pct: Math.round(bat.level * 100),
          charging: bat.charging,
        });
      }
    } catch {
      // Leave snapshot null in unsupported browsers
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    void fetchSnapshot();

    let cancelled = false;
    let unlistenSnap: (() => void) | null = null;
    let unlistenLegacy: (() => void) | null = null;
    if (isTauriRuntime()) {
      void safeListen<HardwareSnapshot>('hardware-snapshot', (payload) => {
        if (cancelled) return;
        setSnapshot(payload);
        setLoading(false);
        setError(null);
      }).then((fn) => {
        if (cancelled) fn();
        else unlistenSnap = fn;
      });
      void safeListen<HardwareSnapshot>('hardware-update', (payload) => {
        if (cancelled) return;
        setSnapshot(payload);
        setLoading(false);
        setError(null);
      }).then((fn) => {
        if (cancelled) fn();
        else unlistenLegacy = fn;
      });
    }

    return () => {
      cancelled = true;
      if (unlistenSnap) unlistenSnap();
      if (unlistenLegacy) unlistenLegacy();
    };
  }, [enabled, fetchSnapshot]);

  return { snapshot, loading, error, refresh: fetchSnapshot };
}
