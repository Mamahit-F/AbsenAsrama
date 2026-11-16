import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, Lock, ShieldCheck } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { ResultMark } from "../../components/camera";
import { Badge, Button, Card, Empty, Field, Item, SelectField, Stagger, TextArea } from "../../components/ui";
import {
  attendanceApi,
  isApiError,
  residentsApi,
  schedulesApi,
  type AttendanceRecordDto,
  type AttendanceStatus,
  type ResidentProfileDto,
  type SessionDto,
} from "../../api";
import { useAuth, useToast } from "../../state/app";
import { shiftDate, toWitaDate, toWitaTime, wita } from "../../lib/utils";

const QUICK_REASONS = [
  "Kamera ponsel penghuni rusak",
  "Perangkat penghuni sedang diperbaiki",
  "Cedera wajah sementara (perban medis)",
  "Gangguan teknis kamera pada pos jaga",
];

export default function ManualAttendance() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const w = wita();

  const [activeResidents, setActiveResidents] = useState<ResidentProfileDto[]>([]);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [sessionRecords, setSessionRecords] = useState<AttendanceRecordDto[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [residentId, setResidentId] = useState(params.get("residentId") || "");
  const [sessionId, setSessionId] = useState(params.get("sessionId") || "");
  const [status, setStatus] = useState<AttendanceStatus>("HADIR");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    name: string;
    nim: string;
    session: string;
    status: AttendanceStatus;
    time: string;
    reason: string;
    isEdit: boolean;
  } | null>(null);

  const loadInit = useCallback(async () => {
    setLoadingInit(true);
    try {
      const [resList, sessList, actSess] = await Promise.all([
        residentsApi.listResidents({ status: "AKTIF" }),
        schedulesApi.listSessions(),
        schedulesApi.getActiveSession(),
      ]);
      const minEditableDate = shiftDate(wita().date, -7);
      const editableSessions = sessList.filter(
        (s) => s.status !== "CANCELLED" && toWitaDate(s.startsAt) >= minEditableDate,
      );
      setActiveResidents(resList);
      setSessions(editableSessions);

      const paramResId = params.get("residentId");
      if (paramResId && resList.some((r) => r.id === paramResId)) {
        setResidentId(paramResId);
      } else {
        setResidentId("");
      }

      const paramSessId = params.get("sessionId");
      if (paramSessId && editableSessions.some((s) => s.id === paramSessId)) {
        setSessionId(paramSessId);
      } else {
        setSessionId((prev) =>
          prev && editableSessions.some((s) => s.id === prev) ? prev : actSess?.id || editableSessions[0]?.id || "",
        );
      }
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat daftar penghuni dan sesi.");
    } finally {
      setLoadingInit(false);
    }
  }, [params]);

  useEffect(() => {
    void loadInit();
  }, [loadInit]);

  useEffect(() => {
    if (!sessionId) {
      setSessionRecords([]);
      return;
    }
    let active = true;
    attendanceApi
      .getSessionRecap(sessionId)
      .then((recap) => {
        if (active) setSessionRecords(recap.records ?? []);
      })
      .catch(() => {
        if (active) setSessionRecords([]);
      });
    return () => {
      active = false;
    };
  }, [sessionId, saved]);

  const selectedResident = useMemo(
    () => activeResidents.find((x) => x.id === residentId) ?? null,
    [activeResidents, residentId],
  );

  const existingRecord = useMemo(
    () => sessionRecords.find((r) => r.residentId === residentId) ?? null,
    [sessionRecords, residentId],
  );

  const isFaceScanLocked = Boolean(
    existingRecord &&
      (existingRecord.method === "SCAN" || existingRecord.method === "DIBANTU_PENJAGA"),
  );

  useEffect(() => {
    if (existingRecord) {
      setStatus(existingRecord.status);
    }
  }, [existingRecord]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || isFaceScanLocked) return;
    if (!reason.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    const r = selectedResident;
    const s = sessions.find((x) => x.id === sessionId);
    if (!r || !s) {
      setError("Pilih sesi presensi (maksimal 7 hari ke belakang) dan penghuni terlebih dahulu.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const rec = existingRecord
        ? await attendanceApi.correctAttendance(existingRecord.id, {
            status,
            correctionReason: reason.trim(),
          })
        : await attendanceApi.recordManual({
            sessionId: s.id,
            residentId: r.id,
            status,
            reason: reason.trim(),
          });
      toast(existingRecord ? "Riwayat presensi berhasil diperbarui" : "Presensi Manual berhasil disimpan");
      setSaved({
        name: r.fullName,
        nim: r.nim,
        session: s.scheduleName,
        status,
        time: toWitaTime(rec.correctedAt || rec.recordedAt) || w.time,
        reason: reason.trim(),
        isEdit: Boolean(existingRecord),
      });
    } catch (ex) {
      setError(isApiError(ex) ? ex.message : "Gagal menyimpan presensi manual.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatRoom = (r: ResidentProfileDto) => {
    if (r.building && r.roomNumber) return `${r.building}-${r.roomNumber}`;
    return r.roomNumber || r.building || "-";
  };

  return (
    <Page nav={false}>
      <TopBar
        back="/penjaga/kehadiran"
        title="Catat presensi manual"
        sub={user?.hallName ? `Monitor ${user.hallName} · Metode: Manual · dicatat ke Audit Log` : "Metode: Manual · dicatat ke Audit Log"}
      />

      {loadingInit ? (
        <Card className="p-6 text-center text-sm text-muted">Memuat data penghuni dan sesi…</Card>
      ) : !selectedResident ? (
        <Card className="space-y-4 p-5">
          <Empty
            icon={<Lock className="size-6" />}
            title="Penghuni belum dipilih"
            text="Pilih penghuni terlebih dahulu dari halaman Kehadiran sebelum mencatat presensi manual."
          />
          <Button block size="lg" onClick={() => nav("/penjaga/kehadiran")}>
            Pilih Penghuni di Halaman Kehadiran
          </Button>
        </Card>
      ) : !saved ? (
        <Stagger>
          <Card className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <Badge tone="warning" dot>
                Metode: Manual
              </Badge>
              <span className="font-display text-xs text-muted">{w.time} WITA</span>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <SelectField
                label="Sesi presensi (maksimal 7 hari ke belakang)"
                value={sessionId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  setError("");
                }}
              >
                {sessions.length === 0 ? (
                  <option value="">Belum ada sesi dalam 7 hari terakhir</option>
                ) : (
                  sessions.map((s) => {
                    const closedOrPast = s.status !== "OPEN" || Date.parse(s.endsAt) <= Date.now();
                    return (
                      <option key={s.id} value={s.id}>
                        {s.scheduleName} ({toWitaDate(s.startsAt)} · {toWitaTime(s.startsAt)}–{toWitaTime(s.endsAt)} WITA ·{" "}
                        {closedOrPast ? "Ditutup / Riwayat" : "Aktif"})
                      </option>
                    );
                  })
                )}
              </SelectField>

              <Field
                label="Penghuni terpilih"
                type="text"
                readOnly
                value={`${selectedResident.fullName} — ${selectedResident.nim} (${formatRoom(selectedResident)})`}
                trailing={<Lock className="size-4 text-muted" aria-hidden />}
              />

              {isFaceScanLocked ? (
                <div className="rounded-2xl bg-amber-500/12 p-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Penghuni ini sudah melakukan presensi melalui <strong>Scan Wajah</strong> pada sesi ini. Status
                  kehadiran sudah terkunci dan tidak dapat diubah atau diedit.
                </div>
              ) : (
                existingRecord && (
                  <div className="rounded-2xl bg-primary-soft p-3 text-xs text-primary">
                    Penghuni ini sudah tercatat <strong>{existingRecord.status === "HADIR" ? "Hadir" : "Tidak Hadir"}</strong>{" "}
                    pada sesi ini. Menyimpan formulir akan <strong>mengedit riwayat presensi</strong> tersebut.
                  </div>
                )
              )}

              <SelectField
                label="Status kehadiran"
                value={status}
                disabled={isFaceScanLocked}
                onChange={(e) => {
                  setStatus(e.target.value as AttendanceStatus);
                  setError("");
                }}
              >
                <option value="HADIR">HADIR (Diizinkan / kendala kamera)</option>
                <option value="TIDAK_HADIR">TIDAK HADIR (Tanpa keterangan / izin khusus)</option>
              </SelectField>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">Pilih cepat alasan umum:</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REASONS.map((qr) => (
                    <button
                      key={qr}
                      type="button"
                      disabled={isFaceScanLocked}
                      onClick={() => {
                        setReason(qr);
                        setError("");
                      }}
                      className="soft-inset rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
                    >
                      {qr}
                    </button>
                  ))}
                </div>
              </div>

              <TextArea
                label="Alasan presensi manual (Wajib · J-03)"
                placeholder="Jelaskan mengapa scan wajah tidak dapat dilakukan…"
                value={reason}
                disabled={isFaceScanLocked}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError("");
                }}
                error={error}
                hint={`Dicatat atas nama penjaga: ${user!.name}`}
              />

              <Button
                type="submit"
                block
                size="lg"
                disabled={submitting || loadingInit || !sessionId || !selectedResident || isFaceScanLocked}
                icon={<ClipboardCheck className="size-5" />}
              >
                {submitting
                  ? "Menyimpan…"
                  : isFaceScanLocked
                    ? "Terkunci (Sudah Scan Wajah)"
                    : existingRecord
                      ? "Simpan perubahan riwayat presensi"
                      : "Simpan presensi manual"}
              </Button>
            </form>
          </Card>

          <Item className="soft-inset mt-4 flex items-start gap-2.5 rounded-2xl p-4 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Penjaga dapat mencatat presensi manual pada sesi yang sudah <strong>Ditutup</strong> maupun{" "}
              <strong>mengedit riwayat presensi manual/alpha hingga 7 hari ke belakang</strong>. Presensi hasil{" "}
              <strong>Scan Wajah</strong> tidak dapat diubah.
            </span>
          </Item>
        </Stagger>
      ) : (
        <Card className="mt-6 p-6 text-center">
          <ResultMark ok size={76} />
          <h2 className="mt-4 text-xl font-semibold">
            {saved.isEdit ? "Riwayat Presensi Diperbarui" : "Presensi Manual Tercatat"}
          </h2>
          <p className="mt-1 text-sm text-muted">Data tersimpan dan dicatat pada Audit Log.</p>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-left text-sm">
            {[
              ["Penghuni", saved.name],
              ["NIM", saved.nim],
              ["Sesi", saved.session],
              ["Status", saved.status === "HADIR" ? "Hadir" : "Tidak Hadir"],
              ["Waktu", `${saved.time} WITA`],
              ["Metode", "Manual"],
              ["Penjaga", user!.name],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase text-subtle">{k}</dt>
                <dd className="truncate font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 border-t border-line pt-3 text-left text-sm">
            <p className="text-[11px] font-semibold uppercase text-subtle">Alasan</p>
            <p className="font-semibold">{saved.reason}</p>
          </div>
          <div className="mt-5 flex gap-2.5">
            <Button
              variant="glass"
              block
              onClick={() => {
                setSaved(null);
                setReason("");
              }}
            >
              Catat lagi
            </Button>
            <Button block onClick={() => nav("/penjaga/kehadiran")}>
              Ke daftar hadir
            </Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
