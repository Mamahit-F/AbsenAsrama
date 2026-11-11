import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Avatar, Badge, Button, Card, Field, Item, Sheet, Stagger } from "../../components/ui";
import { useAuth, useToast } from "../../state/app";
import { TZ } from "../../lib/utils";

export default function Account() {
  const { user, logout, changePassword } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [pwOpen, setPwOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const backTo =
    user.role === "admin" ? "/admin" : user.role === "penjaga" ? "/penjaga" : "/penghuni";

  const roleBadgeLabel =
    user.backendRole === "VILLAGE_DEAN"
      ? "DEKAN ASRAMA (VILLAGE DEAN)"
      : user.role.toUpperCase();

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      toast("Anda telah keluar dari sesi");
      nav("/masuk", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setPwError("");

    if (!currentPassword) {
      setPwError("Kata sandi lama wajib diisi.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("Kata sandi baru minimal 8 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Konfirmasi kata sandi baru tidak cocok.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await changePassword(currentPassword, newPassword);
      if (!res.ok) {
        setPwError(res.error);
        return;
      }
      toast("Kata sandi berhasil diperbarui");
      setPwOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <TopBar back={backTo} title="Akun & Sesi" sub={`Peran aktif: ${roleBadgeLabel}`} />

      <Stagger className="space-y-4">
        <Card className="flex items-center gap-4 p-5">
          <Avatar name={user.name} size={60} />
          <div className="min-w-0 flex-1">
            <Badge tone="info" dot>
              {roleBadgeLabel}
            </Badge>
            <h2 className="mt-1.5 truncate text-lg font-semibold">{user.name}</h2>
            <p className="font-display text-xs text-muted">
              {user.nim ? `NIM ${user.nim}` : `@${user.username}`}
            </p>
          </div>
        </Card>

        <Card className="space-y-3 p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted">
              <Clock className="size-4 text-primary" aria-hidden /> Zona waktu sistem
            </span>
            <span className="font-display font-semibold">{TZ} (WITA · UTC+8)</span>
          </div>
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="flex items-center gap-2 text-muted">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Penyimpanan sandi
            </span>
            <span className="font-semibold text-success">Hash BCrypt + JWT</span>
          </div>
        </Card>

        <Item className="space-y-2.5">
          <Button
            variant="glass"
            block
            size="lg"
            icon={<KeyRound className="size-4" />}
            onClick={() => {
              setPwError("");
              setPwOpen(true);
            }}
          >
            Ubah Kata Sandi
          </Button>

          <Button
            variant="danger"
            block
            size="lg"
            disabled={loggingOut}
            icon={<LogOut className="size-4" />}
            onClick={handleLogout}
          >
            {loggingOut ? "Mengakhiri sesi…" : "Keluar dari Akun"}
          </Button>
        </Item>
      </Stagger>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Ubah kata sandi akun">
        <form onSubmit={handleChangePassword} className="space-y-3.5" noValidate>
          <Field
            label="Kata sandi saat ini"
            type="password"
            placeholder="Masukkan kata sandi lama"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setPwError("");
            }}
          />
          <Field
            label="Kata sandi baru (min. 8 karakter)"
            type="password"
            placeholder="Masukkan kata sandi baru"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPwError("");
            }}
          />
          <Field
            label="Konfirmasi kata sandi baru"
            type="password"
            placeholder="Ketik ulang kata sandi baru"
            value={confirmPassword}
            error={pwError}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setPwError("");
            }}
          />
          <Button type="submit" block size="lg" disabled={submitting}>
            {submitting ? "Menyimpan…" : "Simpan Kata Sandi Baru"}
          </Button>
        </form>
      </Sheet>
    </Page>
  );
}
