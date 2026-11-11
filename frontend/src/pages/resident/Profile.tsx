import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { Building2, FileCheck2, IdCard, KeyRound, LogOut, RefreshCcw, RefreshCw, ShieldCheck } from "lucide-react";
import { NightHeader, Page } from "../../components/layout";
import { easeOut, spring, Avatar, Badge, Button, Card, Field, Item, PressCard, SectionTitle, Sheet } from "../../components/ui";
import { isApiError, residentsApi, type ConsentDto, type ResidentProfileDto } from "../../api";
import { useAuth, useToast } from "../../state/app";
import { TZ } from "../../lib/utils";

export default function ResidentProfile() {
  const { user, logout, changePassword } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [profile, setProfile] = useState<ResidentProfileDto | null>(null);
  const [latestConsent, setLatestConsent] = useState<ConsentDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ old: "", next: "", confirm: "" });
  const [err, setErr] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prof = await residentsApi.getMyProfile();
      setProfile(prof);
      try {
        const consents = await residentsApi.getConsents(prof.id);
        const activeConsent = consents.find((c) => !c.revokedAt) ?? consents[0] ?? null;
        setLatestConsent(activeConsent);
      } catch {
        // Abaikan jika belum ada riwayat consent
      }
    } catch (e) {
      setError(isApiError(e) ? e.message : "Gagal memuat profil penghuni.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const displayName = profile?.fullName || user?.name || "Penghuni";
  const displayNim = profile?.nim || user?.nim || "-";
  const roomDisplay = profile?.roomNumber
    ? profile.building
      ? `${profile.building}-${profile.roomNumber}`
      : profile.roomNumber
    : user?.room || "-";
  const isActive = profile ? profile.status === "AKTIF" : true;
  const faceLabel = profile?.hasActiveFaceProfile ? "Aktif" : "Belum Terdaftar";

  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPw) return;
    setErr("");
    if (!pw.old) return setErr("Kata sandi saat ini wajib diisi.");
    if (pw.next.length < 8) return setErr("Kata sandi baru minimal 8 karakter.");
    if (pw.next !== pw.confirm) return setErr("Konfirmasi kata sandi tidak cocok.");

    setSavingPw(true);
    try {
      const res = await changePassword(pw.old, pw.next);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setPwOpen(false);
      setPw({ old: "", next: "", confirm: "" });
      toast("Kata sandi berhasil diperbarui");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <Page>
      <NightHeader className="pb-24 text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...spring, delay: 0.1 }}
          className="mx-auto mt-6 w-fit rounded-full p-1.5"
          style={{ background: "var(--grad-accent)" }}
        >
          <Avatar name={displayName} size={88} className="ring-0" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: easeOut, delay: 0.15 }}
          className="mt-4 text-[26px] font-bold text-white"
        >
          {displayName}
        </motion.h1>
        <p className="mt-0.5 font-display text-[13px] text-night-muted tabular">
          NIM {displayNim} · Kamar {roomDisplay}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Badge tone="navy" dot>
            {isActive ? "Penghuni aktif" : "Dinonaktifkan"}
          </Badge>
          <Badge tone="navy">Wajah: {loading ? "…" : faceLabel}</Badge>
        </div>
      </NightHeader>

      {error && (
        <Card className="mb-3 flex items-center justify-between gap-3 p-4">
          <p className="text-xs font-semibold text-danger">{error}</p>
          <Button size="sm" variant="glass" onClick={() => void loadProfile()} icon={<RefreshCw className="size-3.5" />}>
            Ulangi
          </Button>
        </Card>
      )}

      <SectionTitle>Informasi asrama</SectionTitle>
      <Card className="divide-y divide-line p-2">
        <div className="flex items-center gap-3 px-3 py-3">
          <IdCard className="size-5 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-semibold text-muted">NIM resmi</span>
          <span className="font-display text-sm font-semibold">{displayNim}</span>
        </div>
        <div className="flex items-center gap-3 px-3 py-3">
          <Building2 className="size-5 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-semibold text-muted">Kamar asrama</span>
          <span className="text-sm font-semibold">{roomDisplay}</span>
        </div>
        <div className="flex items-center gap-3 px-3 py-3">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-semibold text-muted">Pelindung embedding</span>
          <span className="text-xs font-semibold text-success">Terenkripsi</span>
        </div>
      </Card>

      <SectionTitle>Data wajah & keamanan</SectionTitle>
      <div className="space-y-2.5">
        <PressCard onClick={() => nav(profile?.hasActiveConsent ? "/penghuni/daftar-wajah" : "/penghuni/persetujuan")} className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl soft-sm text-primary">
            <RefreshCcw className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Daftar ulang wajah</p>
            <p className="text-xs text-muted">Embedding lama tetap dipakai sampai pendaftaran baru lolos.</p>
          </div>
        </PressCard>

        <PressCard onClick={() => nav("/penghuni/persetujuan")} className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl soft-sm text-primary">
            <FileCheck2 className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Bukti persetujuan data wajah</p>
            <p className="text-xs text-muted">
              {latestConsent?.consentedAt
                ? `Disetujui ${new Date(latestConsent.consentedAt).toLocaleString("id-ID", {
                    timeZone: TZ,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })} WITA (${latestConsent.consentVersion})`
                : profile?.hasActiveConsent
                  ? `Aktif (${profile.activeConsentVersion || "v1.0"})`
                  : "Belum menyetujui"}
            </p>
          </div>
        </PressCard>

        <PressCard onClick={() => setPwOpen(true)} className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl soft-sm text-primary">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Ubah kata sandi</p>
            <p className="text-xs text-muted">Perbarui kata sandi akun penghuni Anda.</p>
          </div>
        </PressCard>
      </div>

      <Item className="mt-6">
        <Button
          block
          variant="danger"
          icon={<LogOut className="size-5" />}
          onClick={async () => {
            await logout();
            nav("/masuk", { replace: true });
          }}
        >
          Keluar dari akun
        </Button>
      </Item>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Ubah kata sandi">
        <form onSubmit={savePw} className="space-y-3.5" noValidate>
          <Field
            label="Kata sandi saat ini"
            type="password"
            value={pw.old}
            onChange={(e) => {
              setPw({ ...pw, old: e.target.value });
              setErr("");
            }}
          />
          <Field
            label="Kata sandi baru"
            type="password"
            value={pw.next}
            onChange={(e) => {
              setPw({ ...pw, next: e.target.value });
              setErr("");
            }}
            error={err}
          />
          <Field
            label="Ulangi kata sandi baru"
            type="password"
            value={pw.confirm}
            onChange={(e) => {
              setPw({ ...pw, confirm: e.target.value });
              setErr("");
            }}
          />
          <Button type="submit" block size="lg" disabled={savingPw}>
            {savingPw ? "Menyimpan…" : "Simpan kata sandi"}
          </Button>
        </form>
      </Sheet>
    </Page>
  );
}
