import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Clock4, Database, FileCheck2, Info, RefreshCw, Scale, Target, Wrench } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Button, Card, Checkbox, Item, Stagger, spring } from "../../components/ui";
import { enrollmentApi, isApiError, residentsApi, type ConsentDto, type ResidentProfileDto } from "../../api";
import { useToast } from "../../state/app";
import { TZ } from "../../lib/utils";

const SECTIONS = [
  { icon: Target, title: "Tujuan pengumpulan", body: "Data wajah dipakai semata-mata untuk memverifikasi kehadiran Anda pada sesi presensi asrama, sehingga presensi tidak dapat diwakilkan." },
  { icon: Database, title: "Data yang dikumpulkan", body: "5 foto wajah (lurus, kiri, kanan, atas, bawah) selama proses pendaftaran, embedding wajah (representasi numerik), skor liveness dan skor kecocokan saat pemindaian." },
  { icon: Wrench, title: "Cara data digunakan", body: "Foto diperiksa kualitas dan liveness-nya, lalu diubah menjadi embedding oleh model ArcFace. Saat presensi, wajah dibandingkan hanya dengan penghuni berstatus Aktif." },
  { icon: Info, title: "Penyimpanan", body: "Foto pendaftaran hanya disimpan sementara dan dihapus setelah embedding terbentuk. Embedding disimpan terenkripsi, hanya dapat diakses layanan pengenalan wajah, dan tidak pernah dikirim ke aplikasi." },
  { icon: Clock4, title: "Masa penyimpanan", body: "Embedding disimpan selama Anda terdaftar sebagai penghuni asrama. Saat data penghuni dihapus admin, profil dan embedding ikut dihapus; riwayat presensi tetap disimpan." },
  { icon: Scale, title: "Hak Anda", body: "Anda berhak mengetahui, memperbarui (daftar ulang), dan meminta penghapusan data wajah melalui admin asrama, serta menarik persetujuan yang berakibat presensi wajah tidak dapat digunakan." },
];

export default function Consent() {
  const toast = useToast();
  const nav = useNavigate();

  const [profile, setProfile] = useState<ResidentProfileDto | null>(null);
  const [activeConsent, setActiveConsent] = useState<ConsentDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [open, setOpen] = useState<number | null>(0);
  const [agree, setAgree] = useState(false);

  const loadConsent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prof, consents] = await Promise.all([
        residentsApi.getMyProfile(),
        enrollmentApi.getMyConsents(),
      ]);
      setProfile(prof);
      const found = consents.find((c) => !c.revokedAt) ?? null;
      setActiveConsent(found);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat status persetujuan biometrik.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConsent();
  }, [loadConsent]);

  const given = activeConsent?.consentedAt ?? (profile?.hasActiveConsent ? profile.updatedAt : null);

  const accept = async () => {
    if (submitting || !agree) return;
    setSubmitting(true);
    try {
      const created = await enrollmentApi.giveMyConsent({
        consentVersion: "v1.0",
        evidencePath: "web-consent-v1.0",
      });
      setActiveConsent(created);
      toast("Persetujuan data wajah tersimpan");
      nav("/penghuni/daftar-wajah", { replace: true });
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal menyimpan persetujuan data wajah.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async () => {
    if (!profile || submitting) return;
    setSubmitting(true);
    try {
      await residentsApi.revokeConsent(profile.id);
      setActiveConsent(null);
      setAgree(false);
      toast("Persetujuan data wajah telah dicabut", "info");
      await loadConsent();
    } catch (e) {
      toast(isApiError(e) ? e.message : "Gagal mencabut persetujuan data wajah.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page nav={false}>
      <TopBar back title="Persetujuan data wajah" />

      {error && (
        <Card className="mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadConsent()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <Stagger>
        <Item>
          <p className="text-[15px] text-muted">
            Baca informasi berikut sebelum mendaftarkan wajah. Pendaftaran tidak dapat dilanjutkan tanpa persetujuan Anda (P-05).
          </p>
        </Item>
        <div className="mt-5 space-y-2.5">
          {SECTIONS.map((s, i) => {
            const on = open === i;
            return (
              <Item key={s.title} className="glass overflow-hidden rounded-3xl">
                <motion.button
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setOpen(on ? null : i)}
                  aria-expanded={on}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl soft-sm text-primary">
                    <s.icon className="size-5" aria-hidden />
                  </span>
                  <span className="flex-1 text-[15px] font-semibold">{s.title}</span>
                  <motion.span animate={{ rotate: on ? 180 : 0 }} transition={spring}>
                    <ChevronDown className="size-5 text-muted" aria-hidden />
                  </motion.span>
                </motion.button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div
                      key="c"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
                      style={{ overflow: "hidden" }}
                    >
                      <p className="px-4 pb-4 pl-[68px] text-sm leading-relaxed text-muted">{s.body}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Item>
            );
          })}
        </div>

        {loading ? (
          <Card className="mt-5 p-5 text-center text-sm text-muted">Memeriksa status persetujuan…</Card>
        ) : given ? (
          <Item className="glass mt-5 flex gap-3 rounded-3xl p-4">
            <FileCheck2 className="size-6 shrink-0 text-success" aria-hidden />
            <div className="flex-1">
              <p className="font-semibold">Persetujuan tercatat ({activeConsent?.consentVersion || "v1.0"})</p>
              <p className="text-sm text-muted">
                Disetujui{" "}
                {new Date(given).toLocaleString("id-ID", {
                  timeZone: TZ,
                  dateStyle: "long",
                  timeStyle: "short",
                })}{" "}
                WITA
              </p>
            </div>
          </Item>
        ) : (
          <Item className="glass mt-5 rounded-3xl p-4">
            <Checkbox checked={agree} onChange={setAgree}>
              Saya telah membaca informasi di atas dan menyetujui pengumpulan serta pemrosesan data wajah saya untuk presensi asrama.
            </Checkbox>
          </Item>
        )}

        <Item className="mt-5 space-y-2.5">
          {given ? (
            <>
              <Button block size="lg" onClick={() => nav("/penghuni/daftar-wajah")}>
                Lanjut ke pendaftaran wajah
              </Button>
              <Button
                block
                variant="glass"
                disabled={submitting}
                onClick={() => void revoke()}
              >
                Cabut persetujuan data wajah
              </Button>
            </>
          ) : (
            <Button block size="lg" disabled={!agree || submitting || loading} onClick={() => void accept()}>
              {submitting ? "Menyimpan persetujuan…" : "Setuju dan lanjutkan"}
            </Button>
          )}
        </Item>
      </Stagger>
    </Page>
  );
}
