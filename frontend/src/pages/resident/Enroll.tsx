import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Camera, Check, HelpCircle, RefreshCcw, ShieldCheck, Sparkles, WifiOff, X } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import {
  Pipeline,
  ResultMark,
  Viewfinder,
  type CamAccessState,
  type CamState,
  type ViewfinderHandle,
} from "../../components/camera";
import { Badge, Button, Card, spring } from "../../components/ui";
import {
  attendanceApi,
  enrollmentApi,
  helpRequestsApi,
  isApiError,
  residentsApi,
  type EnrollmentDetailDto,
  type FacePose,
  type ResidentProfileDto,
} from "../../api";
import { useToast } from "../../state/app";
import { cn } from "../../lib/utils";

const POSES: { key: string; apiPose: FacePose; label: string; hint: string }[] = [
  { key: "lurus", apiPose: "LURUS", label: "Lurus", hint: "Tatap lurus ke kamera dengan ekspresi netral" },
  { key: "kanan", apiPose: "KANAN", label: "Kanan", hint: "Tolehkan kepala sedikit ke arah kanan (~20°)" },
  { key: "kiri", apiPose: "KIRI", label: "Kiri", hint: "Tolehkan kepala sedikit ke arah kiri (~20°)" },
  { key: "atas", apiPose: "ATAS", label: "Atas", hint: "Angkat dagu sedikit ke atas" },
  { key: "bawah", apiPose: "BAWAH", label: "Bawah", hint: "Tundukkan kepala sedikit ke bawah" },
];

interface PoseSlot {
  status: "empty" | "checking" | "ok" | "fail";
  reason?: string;
}

const FINAL_STEPS = [
  "Memeriksa kelengkapan 5 pose",
  "Pemeriksaan Liveness / PAD",
  "Membangun embedding ArcFace",
  "Memeriksa duplikasi wajah (S-05)",
  "Mengaktifkan status wajah (P-06)",
];

export default function Enroll() {
  const toast = useToast();
  const nav = useNavigate();
  const vfRef = useRef<ViewfinderHandle>(null);

  const [profile, setProfile] = useState<ResidentProfileDto | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentDetailDto | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean>(true);
  const [camAccess, setCamAccess] = useState<CamAccessState>("loading");
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [sendingHelp, setSendingHelp] = useState(false);

  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState<PoseSlot[]>(POSES.map(() => ({ status: "empty" })));
  const [finalizing, setFinalizing] = useState(false);
  const [finalStep, setFinalStep] = useState(-1);
  const [finalResult, setFinalResult] = useState<{
    ok: boolean;
    title: string;
    text: string;
    failedAt?: number;
  } | null>(null);

  const initEnrollment = useCallback(async () => {
    setLoadingInit(true);
    setInitError(null);
    try {
      const [prof, aiStat] = await Promise.all([
        residentsApi.getMyProfile(),
        attendanceApi.getAiStatus().catch(() => ({ available: false, healthy: false, service: "AI", status: "OFFLINE" })),
      ]);
      setProfile(prof);
      setAiAvailable(Boolean(aiStat.available && aiStat.healthy));

      if (!prof.hasActiveConsent) {
        nav("/penghuni/persetujuan", { replace: true });
        return;
      }

      const started = await enrollmentApi.start({ residentId: prof.id });
      setEnrollment(started);

      if (started.photos && started.photos.length > 0) {
        const nextSlots: PoseSlot[] = POSES.map((p) => {
          const hit = started.photos.find((ph) => ph.pose === p.apiPose);
          if (!hit) return { status: "empty" };
          if (hit.qualityPassed && hit.livenessPassed) return { status: "ok" };
          return {
            status: "fail",
            reason: hit.rejectionReason || "Kualitas atau liveness belum memenuhi syarat.",
          };
        });
        setSlots(nextSlots);
        const firstIncomplete = nextSlots.findIndex((s) => s.status !== "ok");
        if (firstIncomplete >= 0) setIdx(firstIncomplete);
      }
    } catch (e) {
      setInitError(isApiError(e) ? e.message : "Gagal memulai sesi pendaftaran wajah.");
    } finally {
      setLoadingInit(false);
    }
  }, [nav]);

  useEffect(() => {
    void initEnrollment();
  }, [initEnrollment]);

  const isReenroll = Boolean(profile?.hasActiveFaceProfile);
  const currentPose = POSES[idx];
  const currentSlot = slots[idx];
  const allPassed = slots.every((s) => s.status === "ok");

  const camState: CamState =
    currentSlot.status === "checking"
      ? "scanning"
      : currentSlot.status === "ok"
        ? "ok"
        : currentSlot.status === "fail"
          ? "fail"
          : "idle";

  const capturePose = async () => {
    if (!enrollment || currentSlot.status === "checking") return;
    if (camAccess !== "on") {
      toast("Kamera belum siap atau izin kamera ditolak.", "error");
      return;
    }

    const blob = await vfRef.current?.captureFrame(0.92);
    if (!blob) {
      toast("Gagal mengambil gambar dari kamera. Coba lagi.", "error");
      return;
    }

    setSlots((prev) => prev.map((s, i) => (i === idx ? { status: "checking" } : s)));

    try {
      const resp = await enrollmentApi.uploadPose(
        enrollment.id,
        currentPose.apiPose,
        blob,
        `pose-${currentPose.key}.jpg`,
      );

      if (!resp.accepted) {
        const reason =
          resp.rejectionReason ||
          (!resp.livenessPassed
            ? "Pemeriksaan liveness gagal: pastikan wajah asli terlihat jelas."
            : "Kualitas foto belum memenuhi syarat.");
        setSlots((prev) => prev.map((s, i) => (i === idx ? { status: "fail", reason } : s)));
        return;
      }

      setSlots((prev) => {
        const updated = prev.map((s, i) => (i === idx ? { status: "ok" as const } : s));
        const nextEmpty = updated.findIndex((s, i) => i !== idx && s.status !== "ok");
        if (nextEmpty >= 0) {
          setIndexAfterCapture(nextEmpty);
        }
        return updated;
      });
    } catch (e) {
      const msg = isApiError(e) ? e.message : "Gagal mengunggah foto pose ke server.";
      setSlots((prev) => prev.map((s, i) => (i === idx ? { status: "fail", reason: msg } : s)));
    }
  };

  const setIndexAfterCapture = (nextIdx: number) => {
    setIdx(nextIdx);
  };

  const finalize = async () => {
    if (!enrollment || finalizing) return;
    setFinalizing(true);
    setFinalResult(null);
    setFinalStep(2);

    try {
      const completed = await enrollmentApi.complete(enrollment.id);
      setFinalStep(FINAL_STEPS.length);
      toast("Status pendaftaran: Aktif");
      setFinalResult({
        ok: true,
        title: "Pendaftaran berhasil · Status Aktif",
        text: isReenroll
          ? `Embedding lama telah diganti secara atomik (${completed.modelVersion}). Foto sementara telah dihapus.`
          : `Seluruh 5 foto lolos pemeriksaan kualitas & liveness (${completed.latencyMs} ms). Anda kini dapat melakukan presensi.`,
      });
    } catch (e) {
      if (isApiError(e)) {
        const isDuplicate = e.status === 409 || e.code === "DUPLICATE_FACE";
        const failedStep = isDuplicate ? 3 : 2;
        setFinalStep(failedStep);
        setFinalResult({
          ok: false,
          title: isDuplicate ? "Wajah sudah terdaftar (S-05)" : "Pendaftaran wajah belum berhasil",
          text: isReenroll
            ? `${e.message}. Embedding wajah lama Anda tetap dipertahankan (P-10).`
            : e.message,
          failedAt: failedStep,
        });
      } else {
        setFinalStep(2);
        setFinalResult({
          ok: false,
          title: "Gangguan Pemrosesan",
          text: "Terjadi kesalahan saat menyelesaikan pendaftaran wajah.",
          failedAt: 2,
        });
      }
    }
  };

  const requestHelp = async () => {
    if (sendingHelp) return;
    setSendingHelp(true);
    try {
      await helpRequestsApi.create({
        residentId: profile?.id ?? null,
        requestType: "PERMINTAAN_BANTUAN",
        subject: "Kendala Pendaftaran Wajah (Enrollment)",
        description: !aiAvailable
          ? "Layanan AI tidak dapat dihubungi saat mencoba mendaftarkan 5 pose wajah."
          : camAccess === "off"
            ? "Kamera perangkat penghuni tidak dapat diakses saat pendaftaran wajah."
            : "Penghuni membutuhkan bantuan petugas untuk pendaftaran wajah.",
      });
      toast("Permintaan bantuan telah dikirim ke penjaga/admin");
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal mengirim permintaan bantuan.", "error");
    } finally {
      setSendingHelp(false);
    }
  };

  return (
    <Page nav={false}>
      <TopBar
        back="/penghuni/wajah"
        title={isReenroll ? "Daftar ulang wajah" : "Pendaftaran wajah"}
        sub={`Pose ${idx + 1} dari 5 · Foto disimpan sementara`}
      />

      {!aiAvailable && (
        <Card className="mb-3 flex items-start gap-2.5 !bg-warning-soft p-3.5 text-xs text-warning">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">Layanan AI pengenalan wajah sedang tidak tersedia</p>
            <p className="mt-0.5 text-warning/90">
              Validasi kualitas dan ekstraksi embedding memerlukan layanan FastAPI AI aktif.
            </p>
            <button
              type="button"
              disabled={sendingHelp}
              onClick={() => void requestHelp()}
              className="mt-1.5 inline-flex items-center gap-1 underline font-semibold"
            >
              <HelpCircle className="size-3.5" aria-hidden />
              {sendingHelp ? "Mengirim permintaan…" : "Minta bantuan penjaga"}
            </button>
          </div>
        </Card>
      )}

      {initError && (
        <Card className="mb-3 space-y-2 p-4 text-center">
          <p className="text-xs font-semibold text-danger">{initError}</p>
          <Button size="sm" variant="glass" onClick={() => void initEnrollment()}>
            Coba Lagi
          </Button>
        </Card>
      )}

      {isReenroll && (
        <div className="soft-inset mb-3 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
          <span>Embedding lama tetap digunakan sampai pendaftaran baru lolos seluruh pemeriksaan (P-10).</span>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <Badge tone="info" dot>
          Pose: {currentPose.label} ({currentPose.apiPose})
        </Badge>
        <Badge tone={aiAvailable ? "success" : "warning"}>
          {aiAvailable ? "AI Online" : "AI Offline"}
        </Badge>
      </div>

      {/* 5 pose stepper pills */}
      <div className="mb-3 grid grid-cols-5 gap-1.5" role="tablist" aria-label="Pilih pose wajah">
        {POSES.map((p, i) => {
          const s = slots[i];
          const active = i === idx;
          return (
            <motion.button
              key={p.key}
              role="tab"
              aria-selected={active}
              whileTap={{ scale: 0.94 }}
              onClick={() => !finalizing && setIdx(i)}
              className={cn(
                "relative flex h-12 flex-col items-center justify-center rounded-2xl text-xs font-semibold transition-colors",
                active ? "btn-primary" : "glass-soft text-foreground",
              )}
            >
              <span>{p.label}</span>
              <span className="mt-0.5 flex items-center gap-0.5 text-[10px] opacity-85">
                {s.status === "ok" ? (
                  <>
                    <Check className="size-3" strokeWidth={3} aria-hidden /> Lolos
                  </>
                ) : s.status === "fail" ? (
                  <>
                    <X className="size-3" strokeWidth={3} aria-hidden /> Ulang
                  </>
                ) : (
                  `#${i + 1}`
                )}
              </span>
            </motion.button>
          );
        })}
      </div>

      {!finalizing ? (
        <>
          <Viewfinder
            ref={vfRef}
            state={camState}
            pose={currentPose.key}
            label={currentPose.hint}
            onCameraStateChange={setCamAccess}
          />

          <AnimatePresence mode="wait">
            {currentSlot.status === "fail" && currentSlot.reason && (
              <motion.div
                key={currentSlot.reason}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 flex items-start gap-2.5 rounded-2xl bg-danger-soft p-3.5 text-sm font-semibold text-danger"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="flex-1">
                  <p className="font-semibold">Foto pose {currentPose.label} ditolak</p>
                  <p className="mt-0.5 text-xs font-medium">
                    {currentSlot.reason} Foto lain yang sudah lolos tidak perlu diulang (P-04).
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 space-y-2.5">
            <Button
              block
              size="lg"
              loading={currentSlot.status === "checking"}
              disabled={loadingInit || !enrollment || camAccess !== "on" || currentSlot.status === "checking"}
              onClick={() => void capturePose()}
              icon={currentSlot.status === "fail" ? <RefreshCcw className="size-5" /> : <Camera className="size-5" />}
            >
              {camAccess === "off"
                ? "Izinkan kamera untuk mengambil foto"
                : currentSlot.status === "fail"
                  ? `Ulangi foto pose ${currentPose.label}`
                  : currentSlot.status === "ok"
                    ? `Ambil ulang pose ${currentPose.label}`
                    : `Ambil foto pose ${currentPose.label}`}
            </Button>

            {allPassed && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={spring}>
                <Button block size="lg" variant="light" onClick={() => void finalize()} icon={<Sparkles className="size-5" />}>
                  Bentuk Embedding & Aktifkan (5/5 Lolos)
                </Button>
              </motion.div>
            )}
          </div>
        </>
      ) : (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-4">
          <Card className="p-5">
            <p className="mb-3 eyebrowr text-subtle">Pemrosesan AI & Liveness</p>
            <Pipeline steps={FINAL_STEPS} current={finalStep} failedAt={finalResult?.failedAt} />
          </Card>

          <AnimatePresence>
            {finalResult && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="glass rounded-[30px] p-6 text-center"
                role="status"
              >
                <ResultMark ok={finalResult.ok} size={76} />
                <h2 className="mt-4 text-xl font-semibold">{finalResult.title}</h2>
                <p className="mt-1.5 text-sm text-muted">{finalResult.text}</p>
                <div className="mt-5 flex gap-2.5">
                  {!finalResult.ok && (
                    <Button
                      variant="glass"
                      block
                      onClick={() => {
                        setFinalizing(false);
                        setFinalResult(null);
                        setFinalStep(-1);
                      }}
                    >
                      Coba lagi
                    </Button>
                  )}
                  <Button block onClick={() => nav("/penghuni/wajah", { replace: true })}>
                    Selesai
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </Page>
  );
}
