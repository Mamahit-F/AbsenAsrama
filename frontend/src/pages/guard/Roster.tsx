import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardPen, Pencil, RefreshCw, ScanFace, Search, UserPlus } from "lucide-react";
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
import { useAuth, useToast } from "../../state/app";
import { fmtMethodLabel, shiftDate, toWitaDate, toWitaTime, wita } from "../../lib/utils";

export default function Roster() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [residents, setResidents] = useState<ResidentProfileDto[]>([]);
  const [records, setRecords] = useState<AttendanceRecordDto[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [tab, setTab] = useState<"semua" | "hadir" | "tidak">("semua");
  const [q, setQ] = useState("");
  const [claimNim, setClaimNim] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
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
        residentsApi.listResidents({ status: "AKTIF" }),
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

  const handleClaimHall = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNim = claimNim.trim();
    if (!cleanNim) return;
    setClaiming(true);
    setClaimMsg(null);
    try {
      const res = await residentsApi.claimToMyHall(cleanNim);
      toast(`Penghuni ${res.fullName} (${res.nim}) berhasil ditambahkan ke ${user?.hallName || "Hall Anda"}`);
      setClaimMsg({ type: "ok", text: `Berhasil mendaftarkan ${res.fullName} (${res.nim}) ke ${user?.hallName || "Hall Anda"}` });
      setClaimNim("");
      void loadBase();
    } catch (err) {
      const msg = isApiError(err) ? err.message : "Gagal menambahkan penghuni ke Hall.";
      setClaimMsg({ type: "err", text: msg });
    } finally {
      setClaiming(false);
    }
  };

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

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  );
  const isSessionClosedOrExpired = Boolean(
    selectedSession && (selectedSession.status !== "OPEN" || Date.parse(selectedSession.endsAt) <= Date.now()),
  );
  const isWithin7Days = Boolean(
    selectedSession && toWitaDate(selectedSession.startsAt) >= shiftDate(wita().date, -7),
  );

  const rows = useMemo(() => {
    return residents.map((r) => {
      const rec = records.find(
        (a) => a.residentId === r.id || a.residentNim === r.nim,
      );
      const isHadir = rec?.status === "HADIR";
      return {
        resident: r,
        rec,
        status: isHadir ? ("Hadir" as const) : ("Tidak Hadir" as const),
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
      <PageHead
        title="Kehadiran"
        eyebrow={user?.hallName ? `Monitor ${user.hallName} · Hadir / Tidak hadir` : "Hari ini · Hadir / Tidak hadir"}
      />

      {/* Card Pendaftaran Penghuni ke Hall (J-09, P-06, K-07) */}
      <Card className="mb-4 p-4">
        <div className="flex items-center gap-2 text-xs font-bold text-primary">
          <UserPlus className="size-4" />
          <span>Tambah Penghuni ke {user?.hallName || "Hall Anda"}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Masukkan NIM penghuni yang sudah dibuatkan akun oleh Admin untuk mendaftarkannya ke Hall Anda.
        </p>
        <form onSubmit={handleClaimHall} className="mt-3 flex items-center gap-2">
          <input
            type="text"
            placeholder="Ketik NIM penghuni (contoh: 105022010101)..."
            value={claimNim}
            onChange={(e) => {
              setClaimNim(e.target.value);
              setClaimMsg(null);
            }}
            className="soft-inset flex-1 rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Button type="submit" size="sm" disabled={claiming || !claimNim.trim()}>
            {claiming ? "Menambahkan…" : "+ Tambahkan"}
          </Button>
        </form>
        {claimMsg && (
          <div
            className={`mt-2.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
              claimMsg.type === "ok" ? "bg-emerald-500/10 text-emerald-500" : "bg-danger/10 text-danger"
            }`}
          >
            {claimMsg.text}
          </div>
        )}
      </Card>

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
        {sessions.map((s) => {
          const closed = s.status !== "OPEN" || Date.parse(s.endsAt) <= Date.now();
          return (
            <Chip key={s.id} on={s.id === sessionId} onClick={() => setSessionId(s.id)}>
              {s.scheduleName} ({toWitaDate(s.startsAt).slice(5)} · {toWitaTime(s.startsAt)}
              {closed ? " · Ditutup" : ""})
            </Chip>
          );
        })}
        {!loading && sessions.length === 0 && (
          <span className="text-xs text-muted">Belum ada sesi presensi yang dibuka.</span>
        )}
      </div>

      {selectedSession && isSessionClosedOrExpired && (
        <div className="mb-3 rounded-2xl bg-amber-500/12 px-3.5 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {isWithin7Days
            ? "Sesi sudah ditutup — scan wajah dinonaktifkan. Penjaga tetap dapat mencatat manual atau mengedit riwayat presensi sesi ini (maksimal 7 hari ke belakang)."
            : "Sesi sudah lebih dari 7 hari yang lalu — riwayat presensi hanya-baca dan tidak dapat diedit."}
        </div>
      )}

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
              const isFaceScan = rec?.method === "SCAN" || rec?.method === "DIBANTU_PENJAGA";
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
                        {toWitaTime(rec.correctedAt || rec.recordedAt)} WITA · <span className="font-semibold">{mLabel}</span>
                        {rec.recordedByUsername ? ` oleh @${rec.recordedByUsername}` : ""}
                        {rec.correctionReason
                          ? ` — Koreksi: "${rec.correctionReason}"`
                          : rec.reason
                            ? ` — "${rec.reason}"`
                            : ""}
                      </p>
                    )}
                  </div>

                  {rec ? (
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1">
                        <Badge tone={rec.status === "HADIR" ? "success" : "danger"}>
                          {rec.status === "HADIR" ? "Hadir" : "Tidak Hadir"}
                        </Badge>
                        {rec.method && <Badge tone={methodTone(mLabel)}>{mLabel}</Badge>}
                      </div>
                      {isFaceScan ? (
                        <span className="text-[11px] font-medium text-muted">Terkunci (Scan Wajah)</span>
                      ) : (
                        isWithin7Days && (
                          <button
                            onClick={() => nav(`/penjaga/manual?residentId=${resident.id}&sessionId=${sessionId}`)}
                            className="soft-inset flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-primary"
                            aria-label={`Edit riwayat ${resident.fullName}`}
                          >
                            <Pencil className="size-3" aria-hidden /> Edit
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone="danger">{status}</Badge>
                      {isWithin7Days ? (
                        <div className="flex gap-1">
                          {!isSessionClosedOrExpired && (
                            <button
                              onClick={() => nav(`/penjaga/bantu-scan?residentId=${resident.id}&sessionId=${sessionId}`)}
                              className="soft-inset flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-primary"
                              aria-label={`Bantu scan ${resident.fullName}`}
                            >
                              <ScanFace className="size-3.5" aria-hidden /> Scan
                            </button>
                          )}
                          <button
                            onClick={() => nav(`/penjaga/manual?residentId=${resident.id}&sessionId=${sessionId}`)}
                            className="soft-inset flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-warning"
                            aria-label={`Catat manual ${resident.fullName}`}
                          >
                            <ClipboardPen className="size-3.5" aria-hidden /> Manual
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] font-medium text-muted">Terkunci (&gt;7 hari)</span>
                      )}
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
