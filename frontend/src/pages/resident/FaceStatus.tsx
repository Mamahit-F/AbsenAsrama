import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { FileCheck2, RefreshCcw, RefreshCw, ScanFace, ShieldCheck } from "lucide-react";
import { Page, PageHead, ScanArt } from "../../components/layout";
import { Badge, Button, Card, Item, Stagger } from "../../components/ui";
import {
  enrollmentApi,
  isApiError,
  residentsApi,
  type ActiveFaceProfileMetadataDto,
  type ResidentProfileDto,
} from "../../api";
import { TZ } from "../../lib/utils";

const TIMELINE = [
  "Persetujuan data wajah",
  "5 foto pose lolos kualitas",
  "Liveness / PAD lolos",
  "Cek duplikasi wajah",
  "Status Aktif",
];

export default function FaceStatus() {
  const nav = useNavigate();
  const [profile, setProfile] = useState<ResidentProfileDto | null>(null);
  const [faceMeta, setFaceMeta] = useState<ActiveFaceProfileMetadataDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFaceStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prof, meta] = await Promise.all([
        residentsApi.getMyProfile(),
        enrollmentApi.getMyStatus(),
      ]);
      setProfile(prof);
      setFaceMeta(meta);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat status biometrik wajah.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFaceStatus();
  }, [loadFaceStatus]);

  const ok = Boolean(profile?.hasActiveFaceProfile || faceMeta);
  const hasConsent = Boolean(profile?.hasActiveConsent);
  const faceLabel = ok ? "Aktif" : "Belum Terdaftar";
  const reached = ok ? 5 : hasConsent ? 1 : 0;

  const start = () => nav(hasConsent ? "/penghuni/daftar-wajah" : "/penghuni/persetujuan");

  return (
    <Page>
      <PageHead eyebrow="Biometrik" title="Data wajah" />

      {error && (
        <Card className="mb-4 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadFaceStatus()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <Stagger>
        <Item className="relative">
          <ScanArt className="w-52" tags={false} state={ok ? "ok" : "idle"} />
        </Item>
        <Item className="text-center">
          <Badge tone={ok ? "success" : "warning"} dot className="text-[13px]">
            {loading ? "Memuat…" : faceLabel}
          </Badge>
          <h1 className="mt-3 text-2xl font-bold">
            {ok ? "Wajah siap dipakai presensi" : "Wajah belum didaftarkan"}
          </h1>
          <p className="mx-auto mt-2 max-w-[32ch] text-sm text-muted">
            {ok
              ? "Data wajah Anda aktif. Anda dapat mendaftar ulang kapan saja; data lama tetap dipakai sampai yang baru lolos (P-10)."
              : "Ambil 5 foto dengan arahan pose. Prosesnya sekitar 2 menit."}
          </p>
          {faceMeta?.enrolledAt && (
            <p className="mt-1.5 font-display text-xs text-primary">
              Terdaftar pada{" "}
              {new Date(faceMeta.enrolledAt).toLocaleString("id-ID", {
                timeZone: TZ,
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              WITA · Model {faceMeta.modelVersion}
            </p>
          )}
        </Item>

        <Card className="mt-5">
          <p className="mb-3 text-[13px] font-semibold">Tahapan pendaftaran</p>
          <ol className="relative space-y-4 pl-1">
            {TIMELINE.map((t, i) => {
              const done = i < reached;
              return (
                <motion.li
                  key={t}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 + i * 0.07 }}
                  className="flex items-center gap-3"
                >
                  <span
                    className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${
                      done ? "bg-success text-white" : "soft-sm text-subtle"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className={`text-sm font-semibold ${done ? "" : "text-muted"}`}>{t}</span>
                </motion.li>
              );
            })}
          </ol>
        </Card>

        <Item className="soft-inset mt-4 flex gap-3 rounded-2xl p-4">
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
          <p className="text-[13px] text-muted">
            Embedding wajah disimpan terenkripsi di server dan tidak pernah ditampilkan atau dikirim ke perangkat Anda (K-01).
          </p>
        </Item>

        <Item className="mt-6 space-y-3">
          <Button
            block
            size="lg"
            disabled={loading}
            onClick={start}
            icon={ok ? <RefreshCcw className="size-5" /> : <ScanFace className="size-5" />}
          >
            {ok ? "Daftar ulang wajah" : "Mulai pendaftaran"}
          </Button>
          <Button
            block
            variant="glass"
            onClick={() => nav("/penghuni/persetujuan")}
            icon={<FileCheck2 className="size-5" />}
          >
            {hasConsent ? "Lihat bukti persetujuan" : "Berikan persetujuan data wajah"}
          </Button>
        </Item>
      </Stagger>
    </Page>
  );
}
