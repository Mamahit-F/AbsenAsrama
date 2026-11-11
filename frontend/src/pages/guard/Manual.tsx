import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, ShieldCheck } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { ResultMark } from "../../components/camera";
import { Badge, Button, Card, Item, SelectField, Stagger, TextArea } from "../../components/ui";
import {
  attendanceApi,
  isApiError,
  residentsApi,
  schedulesApi,
  type ResidentProfileDto,
  type SessionDto,
} from "../../api";
import { useAuth, useToast } from "../../state/app";
import { toWitaDate, toWitaTime, wita } from "../../lib/utils";

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
  const [loadingInit, setLoadingInit] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [residentId, setResidentId] = useState(params.get("residentId") || "");
  const [sessionId, setSessionId] = useState(params.get("sessionId") || "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    name: string;
    nim: string;
    session: string;
    time: string;
    reason: string;
  } | null>(null);

  const loadInit = useCallback(async () => {
    setLoadingInit(true);
    try {
      const [resList, sessList, actSess] = await Promise.all([
        residentsApi.listResidents({ status: "AKTIF", limit: 300 }),
        schedulesApi.listSessions(),
        schedulesApi.getActiveSession(),
      ]);
      const validSessions = sessList.filter((s) => s.status !== "CANCELLED");
      setActiveResidents(resList);
      setSessions(validSessions);

      const paramResId = params.get("residentId");
      if (paramResId && resList.some((r) => r.id === paramResId)) {
        setResidentId(paramResId);
      } else if (resList.length > 0) {
        setResidentId((prev) => prev || resList[0].id);
      }

      const paramSessId = params.get("sessionId");
      if (paramSessId && validSessions.some((s) => s.id === paramSessId)) {
        setSessionId(paramSessId);
      } else {
        setSessionId((prev) => prev || actSess?.id || validSessions[0]?.id || "");
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!reason.trim()) {
      setError("Alasan wajib diisi. Alasan kosong ditolak (J-03).");
      return;
    }
    const r = activeResidents.find((x) => x.id === residentId);
    const s = sessions.find((x) => x.id === sessionId);
    if (!r || !s) {
      setError("Pilih sesi presensi dan penghuni terlebih dahulu.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const rec = await attendanceApi.recordManual({
        sessionId: s.id,
        residentId: r.id,
        status: "HADIR",
        reason: reason.trim(),
      });
      toast("Presensi Manual berhasil disimpan");
      setSaved({
        name: r.fullName,
        nim: r.nim,
        session: s.scheduleName,
        time: toWitaTime(rec.recordedAt) || w.time,
        reason: reason.trim(),
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
      <TopBar back="/penjaga" title="Catat presensi manual" sub="Metode: Manual · dicatat ke Audit Log" />

      {!saved ? (
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
                label="Sesi presensi"
                value={sessionId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  setError("");
                }}
              >
                {sessions.length === 0 ? (
                  <option value="">
                    {loadingInit ? "Memuat sesi…" : "Belum ada sesi presensi"}
                  </option>
                ) : (
                  sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.scheduleName} ({toWitaDate(s.startsAt)} · {toWitaTime(s.startsAt)}–{toWitaTime(s.endsAt)} WITA)
                    </option>
                  ))
                )}
              </SelectField>

              <SelectField
                label="Penghuni"
                value={residentId}
                onChange={(e) => {
                  setResidentId(e.target.value);
                  setError("");
                }}
              >
                {activeResidents.length === 0 ? (
                  <option value="">
                    {loadingInit ? "Memuat penghuni…" : "Belum ada penghuni aktif"}
                  </option>
                ) : (
                  activeResidents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} — {r.nim} ({formatRoom(r)})
                    </option>
                  ))
                )}
              </SelectField>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">Pilih cepat alasan umum:</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REASONS.map((qr) => (
                    <button
                      key={qr}
                      type="button"
                      onClick={() => {
                        setReason(qr);
                        setError("");
                      }}
                      className="soft-inset rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft"
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
                disabled={submitting || loadingInit || !sessionId || !residentId}
                icon={<ClipboardCheck className="size-5" />}
              >
                {submitting ? "Menyimpan…" : "Simpan presensi manual"}
              </Button>
            </form>
          </Card>

          <Item className="soft-inset mt-4 flex items-start gap-2.5 rounded-2xl p-4 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Sesuai kriteria <strong>J-03 & J-04</strong>, pencatatan manual menandai status <strong>Hadir</strong> dengan metode{" "}
              <strong>Manual</strong> serta menyimpan nama penjaga, alasan, dan waktu pencatatan (WITA).
            </span>
          </Item>
        </Stagger>
      ) : (
        <Card className="mt-6 p-6 text-center">
          <ResultMark ok size={76} />
          <h2 className="mt-4 text-xl font-semibold">Presensi Manual Tercatat</h2>
          <p className="mt-1 text-sm text-muted">Data tersimpan dan dicatat pada Audit Log.</p>
          <dl className="mt-5 grid grid-cols-2 gap-2 text-left text-sm">
            {[
              ["Penghuni", saved.name],
              ["NIM", saved.nim],
              ["Sesi", saved.session],
              ["Waktu", `${saved.time} WITA`],
              ["Metode", "Manual"],
              ["Penjaga", user!.name],
            ].map(([k, v]) => (
              <div key={k} className="soft-inset rounded-2xl px-3 py-2.5">
                <dt className="text-[11px] font-semibold uppercase text-subtle">{k}</dt>
                <dd className="truncate font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="soft-inset mt-2 rounded-2xl px-3 py-2.5 text-left text-sm">
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
