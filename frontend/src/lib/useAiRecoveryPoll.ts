import { useEffect } from "react";
import { attendanceApi } from "../api/attendance";

/**
 * Memantau & memicu pemulihan layanan AI secara berkala saat masih offline/starting,
 * lalu memperbarui state halaman otomatis begitu layanan AI kembali ONLINE.
 */
export function useAiRecoveryPoll(
  active: boolean,
  onStatus: (online: boolean, starting: boolean) => void,
) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await attendanceApi.getAiStatus();
        if (cancelled) return;
        const online = Boolean(res.available && res.healthy);
        onStatus(online, Boolean(res.starting || res.status === "STARTING"));
      } catch {
        if (!cancelled) onStatus(false, false);
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, onStatus]);
}
