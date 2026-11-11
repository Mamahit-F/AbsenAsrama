import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarX2, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { NightHeader, Page } from "../../components/layout";
import { Badge, Button, Card, Empty, IconTile, Num, SectionTitle, Segmented, easeOut, methodTone, spring } from "../../components/ui";
import {
  attendanceApi,
  isApiError,
  schedulesApi,
  type AttendanceRecordDto,
  type SessionDto,
} from "../../api";
import {
  cn,
  fmtDate,
  fmtMethodLabel,
  shiftDate,
  toMin,
  toWitaDate,
  toWitaTime,
  wita,
  witaDayEndIso,
  witaDayStartIso,
} from "../../lib/utils";

export default function ResidentHistory() {
  const [range, setRange] = useState<"7" | "30">("7");
  const w = wita();
  const [picked, setPicked] = useState(w.date);

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [records, setRecords] = useState<AttendanceRecordDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromDate = shiftDate(w.date, -(Number(range) - 1));
      const [sessList, recList] = await Promise.all([
        schedulesApi.listSessions(),
        attendanceApi.getMyHistory({
          from: witaDayStartIso(fromDate),
          to: witaDayEndIso(w.date),
          limit: 200,
        }),
      ]);
      setSessions(sessList);
      setRecords(recList);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat riwayat presensi.");
    } finally {
      setLoading(false);
    }
  }, [range, w.date]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const rows = useMemo(() => {
    const fromDate = shiftDate(w.date, -(Number(range) - 1));
    const out: {
      date: string;
      session: string;
      time?: string;
      method?: string;
      hadir: boolean;
      key: string;
    }[] = [];

    const validSessions = sessions
      .filter((s) => {
        if (s.status === "CANCELLED") return false;
        const d = toWitaDate(s.startsAt);
        if (d < fromDate || d > w.date) return false;
        if (d === w.date && s.status === "OPEN" && toMin(toWitaTime(s.endsAt)) > w.minutes) {
          const alreadyAttended = records.some((r) => r.sessionId === s.id);
          return alreadyAttended;
        }
        return true;
      })
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    const seenSessionIds = new Set<string>();
    for (const s of validSessions) {
      seenSessionIds.add(s.id);
      const d = toWitaDate(s.startsAt);
      const rec = records.find((r) => r.sessionId === s.id);
      const isHadir = rec?.status === "HADIR";
      out.push({
        key: `${s.id}-${d}`,
        date: d,
        session: s.scheduleName,
        time: rec ? toWitaTime(rec.recordedAt) : undefined,
        method: rec ? fmtMethodLabel(rec.method) : undefined,
        hadir: isHadir,
      });
    }

    for (const r of records) {
      if (seenSessionIds.has(r.sessionId)) continue;
      const d = toWitaDate(r.recordedAt);
      if (d < fromDate || d > w.date) continue;
      out.push({
        key: r.id,
        date: d,
        session: "Sesi Presensi",
        time: toWitaTime(r.recordedAt),
        method: fmtMethodLabel(r.method),
        hadir: r.status === "HADIR",
      });
    }

    return out;
  }, [range, records, sessions, w.date, w.minutes]);

  const hadir = rows.filter((r) => r.hadir).length;
  const days = useMemo(
    () => Array.from({ length: Number(range) }, (_, i) => shiftDate(w.date, -i)),
    [range, w.date],
  );
  const dayRows = rows.filter((r) => r.date === picked);

  return (
    <Page>
      <NightHeader className="pb-24">
        <div className="flex items-end justify-between pt-3">
          <div>
            <p className="text-[13px] text-night-muted">Riwayat presensi</p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: easeOut }}
              className="text-[32px] font-bold text-white"
            >
              {picked === w.date ? "Hari ini" : fmtDate(picked, { weekday: "long" })}
            </motion.h1>
          </div>
          <Segmented
            dark
            className="w-[150px]"
            value={range}
            onChange={(v) => {
              setRange(v);
              setPicked(w.date);
            }}
            options={[
              { value: "7", label: "7 hr" },
              { value: "30", label: "30 hr" },
            ]}
          />
        </div>

        <div className="no-scrollbar -mx-5 mt-6 flex gap-3 overflow-x-auto px-5 pb-2" role="listbox" aria-label="Pilih tanggal">
          {days.map((d, i) => {
            const on = d === picked;
            const hits = rows.filter((r) => r.date === d);
            const ok = hits.length > 0 && hits.every((r) => r.hadir);
            return (
              <motion.button
                key={d}
                role="option"
                aria-selected={on}
                onClick={() => setPicked(d)}
                initial={{ opacity: 0, y: -30 }}
                animate={{ opacity: 1, y: on ? 10 : 0 }}
                transition={{ ...spring, delay: Math.min(i, 8) * 0.04 }}
                whileTap={{ scale: 0.92 }}
                className={cn(
                  "relative flex h-[104px] w-[58px] shrink-0 flex-col items-center justify-end rounded-b-full rounded-t-[14px] pb-4 transition-colors duration-300",
                  on
                    ? "bg-gradient-to-b from-[#8b88e8] to-[#5b56c9] text-white shadow-[0_16px_28px_-12px_rgba(91,86,201,.9),inset_0_2px_0_rgba(255,255,255,.25)]"
                    : "bg-[#3a3690] text-white/80 shadow-[inset_0_2px_0_rgba(255,255,255,.08)]",
                )}
              >
                <span className="font-display text-[20px] font-semibold leading-none tabular">{fmtDate(d, { day: "numeric" })}</span>
                {on && <span className="mt-1 text-[11px] font-semibold uppercase">{fmtDate(d, { month: "short" })}</span>}
                {hits.length > 0 && <span className={cn("absolute top-2.5 size-1.5 rounded-full", ok ? "bg-[#6ee7b7]" : "bg-[#fda4af]")} aria-hidden />}
              </motion.button>
            );
          })}
        </div>
      </NightHeader>

      <div className="-mt-4 grid grid-cols-2 gap-4">
        <Card className="flex items-center gap-3 !p-4">
          <IconTile icon={CalendarCheck2} paint="mint" size={46} />
          <div>
            <p className="font-display text-[26px] font-semibold leading-none tabular">
              <Num value={hadir} />
            </p>
            <p className="text-[12px] text-muted">Hadir · {range} hari</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 !p-4">
          <IconTile icon={CalendarX2} paint="rose" size={46} />
          <div>
            <p className="font-display text-[26px] font-semibold leading-none tabular">
              <Num value={rows.length - hadir} />
            </p>
            <p className="text-[12px] text-muted">Tidak hadir</p>
          </div>
        </Card>
      </div>

      <SectionTitle>{fmtDate(picked, { weekday: "long", day: "numeric", month: "long" })}</SectionTitle>

      {error ? (
        <Card className="space-y-3 p-5 text-center">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadHistory()} icon={<RefreshCw className="size-4" />}>
            Coba Lagi
          </Button>
        </Card>
      ) : loading ? (
        <Card className="p-6 text-center text-sm text-muted">Memuat riwayat kehadiran…</Card>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={picked + range}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            transition={spring}
            className="space-y-3"
          >
            {dayRows.length === 0 ? (
              <Empty
                icon={<CalendarCheck2 className="size-6" />}
                title="Belum ada catatan"
                text={picked === w.date ? "Riwayat muncul setelah sesi selesai." : "Tidak ada sesi terjadwal di tanggal ini."}
              />
            ) : (
              dayRows.map((r, i) => (
                <motion.div
                  key={r.key}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: i * 0.06 }}
                  className="soft flex items-center gap-4 rounded-[26px] p-4"
                >
                  <span className={cn("soft-inset grid size-11 shrink-0 place-items-center rounded-full")}>
                    <span className={cn("size-3.5 rounded-full", r.hadir ? "bg-success" : "bg-danger")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[16px] font-semibold">{r.session}</p>
                    <p className="font-display text-[13px] text-muted tabular">{r.hadir ? `${r.time} WITA` : "Tidak ada catatan"}</p>
                  </div>
                  {r.hadir ? <Badge tone={methodTone(r.method!)}>{r.method}</Badge> : <Badge tone="danger">Tidak hadir</Badge>}
                </motion.div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Page>
  );
}
