import { useCallback, useEffect, useState } from "react";
import { KeyRound, LockOpen, Plus, RefreshCw, ShieldAlert, UserCog } from "lucide-react";
import { Page, PageHead } from "../../components/layout";
import { Avatar, Badge, Button, Card, Countdown, Empty, Field, IconButton, Item, Sheet, Stagger, Switch } from "../../components/ui";
import { adminApi, isApiError, mapFieldErrors, type UserAccountDto } from "../../api";
import { useToast } from "../../state/app";

export default function Guards() {
  const toast = useToast();
  const [guards, setGuards] = useState<UserAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openAdd, setOpenAdd] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [resetTarget, setResetTarget] = useState<UserAccountDto | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetErr, setResetErr] = useState("");
  const [resetting, setResetting] = useState(false);

  const loadGuards = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await adminApi.listUsers({ role: "MONITOR" });
      setGuards(list);
    } catch (e) {
      setLoadError(isApiError(e) ? e.message : "Gagal memuat daftar akun penjaga.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGuards();
  }, [loadGuards]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErr("");
    setFieldErrors({});

    const cleanUser = username.trim().toLowerCase();
    if (cleanUser.length < 3) {
      setFieldErrors({ username: "Username penjaga minimal 3 karakter." });
      return;
    }
    if (password.length < 8) {
      setFieldErrors({ password: "Kata sandi awal minimal 8 karakter." });
      return;
    }

    setSubmitting(true);
    try {
      const created = await adminApi.createStaffUser({
        username: cleanUser,
        email: email.trim() ? email.trim() : undefined,
        password,
        role: "MONITOR",
      });
      setGuards((prev) => [created, ...prev]);
      toast(`Akun penjaga @${created.username} berhasil dibuat`);
      setUsername("");
      setEmail("");
      setPassword("");
      setOpenAdd(false);
    } catch (ex) {
      setFieldErrors(mapFieldErrors(ex));
      setErr(isApiError(ex) ? ex.message : "Gagal membuat akun penjaga.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (g: UserAccountDto, nextActive: boolean) => {
    try {
      const updated = await adminApi.setUserActive(g.id, nextActive);
      setGuards((prev) => prev.map((x) => (x.id === g.id ? updated : x)));
      toast(nextActive ? `@${g.username} diaktifkan` : `@${g.username} dinonaktifkan`);
    } catch (ex) {
      toast(isApiError(ex) ? ex.message : "Gagal memperbarui status akun penjaga.", "error");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || resetting) return;
    setResetErr("");
    if (newPassword.length < 8) {
      setResetErr("Kata sandi baru minimal 8 karakter.");
      return;
    }

    setResetting(true);
    try {
      await adminApi.resetUserPassword(resetTarget.id, newPassword);
      toast(`Kata sandi @${resetTarget.username} direset & kunci dibuka`);
      setResetTarget(null);
      setNewPassword("");
      await loadGuards();
    } catch (ex) {
      setResetErr(isApiError(ex) ? ex.message : "Gagal mereset kata sandi penjaga.");
    } finally {
      setResetting(false);
    }
  };

  const formatDisplayName = (u: UserAccountDto) => {
    if (u.residentName) return u.residentName;
    return u.username
      .split(/[._-]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");
  };

  return (
    <Page>
      <PageHead
        title="Penjaga"
        eyebrow="Tambah · nonaktifkan · reset kunci"
        right={
          <IconButton label="Tambah penjaga" tone="solid" onClick={() => setOpenAdd(true)}>
            <Plus className="size-5" aria-hidden />
          </IconButton>
        }
      />

      <Stagger className="space-y-3">
        <Item className="soft-inset flex items-start gap-2.5 rounded-2xl p-3.5 text-xs text-muted">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            Jika kata sandi salah 5 kali berturut-turut, akun penjaga dikunci selama 5 menit (A-04). Admin dapat
            menambah, menonaktifkan, atau mereset kata sandi akun penjaga kapan saja.
          </span>
        </Item>

        {loading ? (
          <Card className="p-6 text-center text-sm text-muted">Memuat daftar akun penjaga…</Card>
        ) : loadError ? (
          <Card className="space-y-3 p-5 text-center">
            <p className="text-xs font-semibold text-danger">{loadError}</p>
            <Button size="sm" variant="glass" onClick={loadGuards} icon={<RefreshCw className="size-4" />}>
              Coba Lagi
            </Button>
          </Card>
        ) : guards.length === 0 ? (
          <Empty
            icon={<UserCog className="size-6" />}
            title="Belum ada akun penjaga"
            text="Tambahkan akun petugas penjaga (MONITOR) baru untuk mengelola sesi presensi."
          />
        ) : (
          guards.map((g) => {
            const lockedMs = g.lockedUntil ? Date.parse(g.lockedUntil) : 0;
            const isLocked = lockedMs > Date.now();
            const displayName = formatDisplayName(g);
            return (
              <Card key={g.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={displayName} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{displayName}</p>
                      <Badge tone={g.isActive ? "success" : "danger"} dot>
                        {g.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                      {isLocked && (
                        <Badge tone="warning">
                          Terkunci <Countdown until={lockedMs} className="ml-1" />
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 font-display text-xs text-muted">
                      @{g.username} · Gagal sandi: {g.failedLoginAttempts}/5
                    </p>
                  </div>

                  <Switch
                    checked={g.isActive}
                    onChange={(v) => void toggleActive(g, v)}
                    label={`Aktifkan penjaga ${displayName}`}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-strong/60 pt-3">
                  <Button
                    size="sm"
                    variant="glass"
                    onClick={() => {
                      setResetTarget(g);
                      setNewPassword("");
                      setResetErr("");
                    }}
                    icon={isLocked ? <LockOpen className="size-4" /> : <KeyRound className="size-4" />}
                  >
                    {isLocked ? "Buka kunci & reset sandi" : "Reset sandi"}
                  </Button>
                  {g.email && <span className="truncate text-xs text-muted">{g.email}</span>}
                </div>
              </Card>
            );
          })
        )}

        <Item className="pt-2">
          <Button block size="lg" onClick={() => setOpenAdd(true)} icon={<UserCog className="size-5" />}>
            Tambah akun penjaga baru
          </Button>
        </Item>
      </Stagger>

      <Sheet open={openAdd} onClose={() => setOpenAdd(false)} title="Tambah akun penjaga">
        <form onSubmit={handleCreate} className="space-y-3.5" noValidate>
          <Field
            label="Username login"
            placeholder="Contoh: ronald.sigar"
            value={username}
            error={fieldErrors.username}
            onChange={(e) => {
              setUsername(e.target.value.toLowerCase().replace(/\s+/g, "."));
              setErr("");
              setFieldErrors((f) => ({ ...f, username: "" }));
            }}
          />
          <Field
            label="Email (opsional)"
            type="email"
            placeholder="ronald.sigar@unklab.ac.id"
            value={email}
            error={fieldErrors.email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErr("");
              setFieldErrors((f) => ({ ...f, email: "" }));
            }}
          />
          <Field
            label="Kata sandi awal (min. 8 karakter)"
            type="password"
            placeholder="Masukkan kata sandi awal penjaga"
            value={password}
            error={fieldErrors.password || err}
            onChange={(e) => {
              setPassword(e.target.value);
              setErr("");
              setFieldErrors((f) => ({ ...f, password: "" }));
            }}
          />
          <Button type="submit" block size="lg" disabled={submitting}>
            {submitting ? "Membuat akun…" : "Buat akun penjaga"}
          </Button>
        </form>
      </Sheet>

      <Sheet
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={resetTarget ? `Reset sandi @${resetTarget.username}` : "Reset sandi penjaga"}
      >
        <form onSubmit={handleResetPassword} className="space-y-3.5" noValidate>
          <Field
            label="Kata sandi baru (min. 8 karakter)"
            type="password"
            placeholder="Masukkan kata sandi baru"
            value={newPassword}
            error={resetErr}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setResetErr("");
            }}
            hint="Mereset kata sandi juga otomatis membuka kunci akun (A-04)."
          />
          <Button type="submit" block size="lg" disabled={resetting}>
            {resetting ? "Menyimpan…" : "Simpan & Buka Kunci"}
          </Button>
        </form>
      </Sheet>
    </Page>
  );
}
