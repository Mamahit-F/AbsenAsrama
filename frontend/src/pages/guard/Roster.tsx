import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardPen, RefreshCw, ScanFace, Search } from "lucide-react";
import { Page, PageHead } from "../../components/layout";
import { Avatar, Badge, Button, Card, Chip, Empty, Field, Item, Segmented, Stagger, methodTone } from "../../components/ui";
import {
  attendanceApi,
  isApiError,
  residentsApi,
  schedulesApi,
  type AttendanceRecordDto,
  type ResidentProfileDto,
  type SessionDto,
} from "../../api";
import { fmtMethodLabel, toWitaDate, toWitaTime } from "../../lib/utils";

export default function Roster() {
  const nav = useNavigate();

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [residents, setResidents] = useState<ResidentProfileDto[]>([]);
  const [records, setRecords] = useState<AttendanceRecordDto[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [tab, setTab] = useState<"semua" | "hadir" | "tidak">("semua");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingRecap, setLoadingRecap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessList, activeSess, resList] = await Promise.all([
        schedulesApi.listSessions(),
        schedulesApi.getActiveSession(),
        residentsApi.listResidents({ status: "AKTIF", limit: 300 }),
      ]);
      const validSessions = sessList.filter((s) => s.status !== "CANCELLED");
      setSessions(validSessions);
      setResidents(resList);

      const initialId =
        activeSess?.id ??
        validSessions[0]?.id ??
        "";
      setSessionId((prev) => prev || initialId);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat daftar penghuni dan sesi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!sessionId) {
      setRecords([]);
      return;
    }
    let active = true;
    setLoadingRecap(true);
    (async () => {
      try {
        const recap = await attendanceApi.getSessionRecap(sessionId);
        if (!active) return;
        setRecords(recap.records ?? []);
      } catch {
        if (!active) return;
        setRecords([]);
      } finally {
        if (active) setLoadingRecap(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [sessionId]);

  const rows = useMemo(() => {
    return residents.map((r) => {
      const rec = records.find(
        (a) => (a.residentId === r.id || a.residentNim === r.nim) && a.status === "HADIR",
      );
      return {
        resident: r,
        rec,
        status: rec ? ("Hadir" as const) : ("Tidak Hadir" as const),
      };
    });
  }, [residents, records]);

  const hadirCount = rows.filter((r) => r.status === "Hadir").length;
  const tidakCount = rows.length - hadirCount;

  const filtered = rows.filter((r) => {
    if (tab === "hadir" && r.status !== "Hadir") return false;
    if (tab === "tidak" && r.status !== "Tidak Hadir") return false;
    if (q.trim()) {
      const k = q.toLowerCase();
      const roomStr = `${r.resident.building ?? ""} ${r.resident.roomNumber ?? ""}`.toLowerCase();
      return (
        r.resident.fullName.toLowerCase().includes(k) ||
        r.resident.nim.toLowerCase().includes(k) ||
        roomStr.includes(k)
      );
    }
    return true;
  });

  const formatRoom = (r: ResidentProfileDto) => {
    if (r.building && r.roomNumber) return `${r.building}-${r.roomNumber}`;
    return r.roomNumber || r.building || "-";
  };

  return (
    <Page>
      <PageHead title="Kehadiran" eyebrow="Hari ini · Hadir / Tidak hadir" />

      {error && (
        <Card className="mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadBase()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      {/* Session selector chips */}
      <div className="no-scrollbar -mx-5 mb-3 flex gap-2 overflow-x-auto px-5">
        {sessions.map((s) => (
          <Chip key={s.id} on={s.id === sessionId} onClick={() => setSessionId(s.id)}>
            {s.scheduleName} ({toWitaDate(s.startsAt).slice(5)} · {toWitaTime(s.startsAt)})
          </Chip>
        ))}
        {!loading && sessions.length === 0 && (
          <span className="text-xs text-muted">Belum ada sesi presensi yang dibuka.</span>
        )}
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "semua", label: "Semua", count: rows.length },
          { value: "hadir", label: "Hadir", count: hadirCount },
          { value: "tidak", label: "Tidak Hadir", count: tidakCount },
        ]}
      />

      <div className="mt-3">
        <Field
          label="Cari penghuni"
          placeholder="Ketik nama, NIM, atau kamar…"
          icon={<Search className="size-4" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading || loadingRecap ? (
        <Card className="mt-4 p-6 text-center text-sm text-muted">Memuat daftar kehadiran sesi…</Card>
      ) : (
        <Stagger className="mt-4 space-y-2.5" key={sessionId + tab}>
          {filtered.length === 0 ? (
            <Empty icon={<Search className="size-6" />} title="Tidak ada data" text="Tidak ada penghuni yang sesuai dengan filter." />
          ) : (
            filtered.map(({ resident, rec, status }) => {
              const roomLabel = formatRoom(resident);
              const mLabel = rec ? fmtMethodLabel(rec.method) : "Scan";
              return (
                <Item key={resident.id} className="glass flex items-center gap-3 rounded-3xl p-3.5">
                  <Avatar name={resident.fullName} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{resident.fullName}</p>
                      <span className="soft-inset rounded-full px-2 py-0.5 font-display text-[11px] font-semibold text-muted">
                        {roomLabel}
                      </span>
                    </div>
                    <p className="font-display text-xs text-muted">{resident.nim}</p>
                    {rec && (
                      <p className="mt-0.5 text-xs text-muted">
                        {toWitaTime(rec.recordedAt)} WITA · <span className="font-semibold">{mLabel}</span>
                        {rec.recordedByUsername ? ` oleh @${rec.recordedByUsername}` : ""}
                        {rec.reason ? ` — "${rec.reason}"` : ""}
                      </p>
                    )}
                  </div>

                  {rec ? (
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone="success">Hadir</Badge>
                      <Badge tone={methodTone(mLabel)}>{mLabel}</Badge>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone="danger">{status}</Badge>
                      <div className="flex gap-1">
                        <button
                          onClick={() => nav(`/penjaga/bantu-scan?residentId=${resident.id}&sessionId=${sessionId}`)}
                          className="soft-inset flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-primary"
                          aria-label={`Bantu scan ${resident.fullName}`}
                        >
                          <ScanFace className="size-3.5" aria-hidden /> Scan
                        </button>
                        <button
                          onClick={() => nav(`/penjaga/manual?residentId=${resident.id}&sessionId=${sessionId}`)}
                          className="soft-inset flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-warning"
                          aria-label={`Catat manual ${resident.fullName}`}
                        >
                          <ClipboardPen className="size-3.5" aria-hidden /> Manual
                        </button>
                      </div>
                    </div>
                  )}
                </Item>
              );
            })
          )}
        </Stagger>
      )}
    </Page>
  );
}
