import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ClipboardPen, ScanFace, ShieldAlert, UserX, WifiOff } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import {
  Pipeline,
  ResultMark,
  Viewfinder,
  type CamAccessState,
  type CamState,
  type ViewfinderHandle,
} from "../../components/camera";
import { Badge, Button, Card, SelectField, TextArea, spring } from "../../components/ui";
import {
  attendanceApi,
  isApiError,
  residentsApi,
  schedulesApi,
  type ResidentProfileDto,
  type SessionDto,
} from "../../api";
import { useAuth, useToast } from "../../state/app";
import { toWitaTime, wita } from "../../lib/utils";

const STEPS = [
  "Memvalidasi sesi aktif & alasan penjaga",
  "Pemeriksaan Liveness / PAD",
  "Mencocokkan wajah khusus ke penghuni terpilih (J-05)",
  "Menyimpan presensi 'Dibantu Penjaga'",
];

export default function AssistedScan() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const vfRef = useRef<ViewfinderHandle>(null);

  const [eligibleResidents, setEligibleResidents] = useState<ResidentProfileDto[]>([]);
  const [activeSess, setActiveSess] = useState<SessionDto | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean>(true);
  const [camAccess, setCamAccess] = useState<CamAccessState>("loading");
  const [loadingInit, setLoadingInit] = useState(true);

  const [residentId, setResidentId] = useState(params.get("residentId") || "");
  const [reason, setReason] = useState("");
  const [errReason, setErrReason] = useState("");
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<{
    ok: boolean;
    title: string;
    text: string;
    failedAt?: number;
  } | null>(null);

  const loadInit = useCallback(async () => {
    setLoadingInit(true);
    try {
      const [resList, actSess, aiStat] = await Promise.all([
        residentsApi.listResidents({ status: "AKTIF", limit: 300 }),
        schedulesApi.getActiveSession(),
        attendanceApi.getAiStatus().catch(() => ({ available: false, healthy: false, service: "AI", status: "OFFLINE" })),
      ]);
      // J-05: Hanya penghuni berstatus AKTIF dengan profil wajah aktif yang dapat diproses scan dibantu penjaga
      const withFace = resList.filter((r) => r.status === "AKTIF" && r.hasActiveFaceProfile);
      setEligibleResidents(withFace);
      setActiveSess(actSess);
      setAiAvailable(Boolean(aiStat.available && aiStat.healthy));

      const paramId = params.get("residentId");
      if (paramId && withFace.some((r) => r.id === paramId)) {
        setResidentId(paramId);
      } else if (withFace.length > 0) {
        setResidentId((prev) => prev || withFace[0].id);
      }
    } finally {
      setLoadingInit(false);
    }
  }, [params]);

  useEffect(() => {
    void loadInit();
  }, [loadInit]);

  const selectedResident = eligibleResidents.find((r) => r.id === residentId);
  const w = wita();

  const cam: CamState = result ? (result.ok ? "ok" : "fail") : step >= 0 ? "scanning" : "idle";

  const runScan = async () => {
    if (!reason.trim()) {
      setErrReason("Alasan wajib diisi sebelum memindai wajah penghuni.");
      return;
    }
    if (!selectedResident) {
      setErrReason("Pilih penghuni yang memiliki profil wajah aktif terlebih dahulu.");
      return;
    }
    if (camAccess !== "on") {
      setErrReason("Kamera belum siap atau izin kamera ditolak.");
      return;
    }

    setErrReason("");
    setResult(null);
    setStep(0);

    const blob = await vfRef.current?.captureFrame(0.92);
    if (!blob) {
      setStep(-1);
      setErrReason("Gagal mengambil gambar dari kamera. Coba lagi.");
      return;
    }

    setStep(2);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `assisted-${Date.now()}`;

      const resp = await attendanceApi.scanGuardAssisted({
        photoBlob: blob,
        residentId: selectedResident.id,
        sessionId: activeSess?.id,
        reason: reason.trim(),
        idempotencyKey,
      });

      toast("Presensi Dibantu Penjaga tercatat");
      setStep(STEPS.length);
      setResult({
        ok: true,
        title: "Presensi Dibantu Penjaga berhasil",
        text: `Tercatat untuk ${selectedResident.fullName} (${selectedResident.nim}) oleh penjaga ${user!.name} pada ${toWitaTime(resp.recordedAt) || w.time} WITA.`,
      });
    } catch (err) {
      if (isApiError(err)) {
        const failedAt =
          err.code === "NO_ACTIVE_SESSION"
            ? 0
            : err.code === "LIVENESS_FAILED"
              ? 1
              : err.code === "FACE_MISMATCH"
                ? 2
                : 3;
        setStep(failedAt);
        setResult({
          ok: false,
          title:
            err.code === "FACE_MISMATCH"
              ? "Wajah tidak cocok dengan penghuni yang dipilih"
              : err.code === "LIVENESS_FAILED"
                ? "Terdeteksi bukan wajah asli"
                : err.status === 409 || err.code === "ALREADY_ATTENDED"
                  ? "Sudah tercatat hadir"
                  : "Presensi dibantu penjaga ditolak",
          text: err.message,
          failedAt,
        });
      } else {
        setStep(1);
        setResult({
          ok: false,
          title: "Gangguan Koneksi",
          text: "Gagal menghubungi server saat memverifikasi wajah penghuni.",
          failedAt: 1,
        });
      }
    }
  };

  const formatRoom = (r: ResidentProfileDto) => {
    if (r.building && r.roomNumber) return `${r.building}-${r.roomNumber}`;
    return r.roomNumber || r.building || "-";
  };

  return (
    <Page>
      <TopBar
        title="Bantu scan wajah"
        sub={
          activeSess
            ? `${activeSess.scheduleName} · ${toWitaTime(activeSess.startsAt)}–${toWitaTime(activeSess.endsAt)} WITA`
            : "Tidak ada sesi presensi aktif"
        }
        right={
          <button
            onClick={() => nav(`/penjaga/manual${residentId ? `?residentId=${residentId}` : ""}`)}
            className="soft-sm flex h-10 items-center gap-1 rounded-full px-3.5 text-xs font-semibold text-primary"
          >
            <ClipboardPen className="size-3.5" aria-hidden /> Manual
          </button>
        }
      />

      {!aiAvailable && (
        <Card className="mb-3 flex items-start gap-2.5 !bg-warning-soft p-3.5 text-xs text-warning">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">Layanan AI sedang tidak tersedia</p>
            <p className="mt-0.5 text-warning/90">
              Gunakan fitur <strong>Presensi Manual</strong> dengan alasan gangguan layanan AI.
            </p>
          </div>
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <Badge tone={activeSess ? "success" : "danger"} dot>
          {activeSess ? `Sesi aktif: ${activeSess.scheduleName}` : "Tidak ada sesi presensi aktif"}
        </Badge>
        <Badge tone={aiAvailable ? "info" : "warning"}>
          {aiAvailable ? "Verifikasi 1:1 (J-05)" : "AI Offline"}
        </Badge>
      </div>

      <Card className="mb-4 space-y-3.5 p-4">
        <SelectField
          label="Pilih penghuni berstatus Aktif"
          value={residentId}
          onChange={(e) => {
            setResidentId(e.target.value);
            setResult(null);
            setStep(-1);
          }}
        >
          {eligibleResidents.length === 0 ? (
            <option value="">
              {loadingInit ? "Memuat penghuni…" : "Tidak ada penghuni dengan wajah terdaftar"}
            </option>
          ) : (
            eligibleResidents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName} — {r.nim} ({formatRoom(r)})
              </option>
            ))
          )}
        </SelectField>

        <TextArea
          label="Alasan dibantu penjaga (wajib diisi)"
          placeholder="Contoh: Kamera ponsel penghuni rusak / baterai habis…"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (errReason) setErrReason("");
          }}
          error={errReason}
        />
      </Card>

      <Viewfinder
        ref={vfRef}
        state={cam}
        label={selectedResident ? `Verifikasi wajah: ${selectedResident.fullName}` : "Pilih penghuni terlebih dahulu"}
        onCameraStateChange={setCamAccess}
      />

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div key="scan-btn" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
            {step >= 0 ? (
              <Card className="p-4">
                <Pipeline steps={STEPS} current={step} />
              </Card>
            ) : (
              <Button
                block
                size="lg"
                disabled={!activeSess || !selectedResident || camAccess !== "on" || !aiAvailable}
                onClick={() => void runScan()}
                icon={<ScanFace className="size-5" />}
              >
                {!activeSess
                  ? "Tidak ada sesi presensi aktif"
                  : camAccess === "off"
                    ? "Kamera perangkat tidak tersedia"
                    : "Pindai & cocokkan wajah penghuni"}
              </Button>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="res-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="glass relative z-10 -mt-12 rounded-[28px] p-5 text-center"
            role="status"
          >
            {result.ok ? (
              <ResultMark ok size={70} />
            ) : (
              <span className="mx-auto grid size-[70px] place-items-center rounded-full bg-danger-soft text-danger">
                {result.failedAt === 2 ? <UserX className="size-8" aria-hidden /> : <ShieldAlert className="size-8" aria-hidden />}
              </span>
            )}
            <h2 className="mt-3 text-lg font-semibold">{result.title}</h2>
            <p className="mt-1 text-sm text-muted">{result.text}</p>
            <div className="mt-4 flex gap-2.5">
              <Button
                variant="glass"
                block
                onClick={() => {
                  setResult(null);
                  setStep(-1);
                }}
              >
                Scan lainnya
              </Button>
              <Button block onClick={() => nav("/penjaga/kehadiran")}>
                Daftar hadir
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}
