import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Lock, LogIn, ShieldAlert, User as UserIcon } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Button, Card, Countdown, Field, Item, Stagger } from "../../components/ui";
import { roleHomePath, useAuth, useToast } from "../../state/app";

export default function Login() {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<{ msg: string; lockedUntil?: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErr(null);
    setSubmitting(true);
    try {
      const r = await login(id, pw);
      if (!r.ok) {
        setErr({ msg: r.error, lockedUntil: r.lockedUntil });
        return;
      }
      toast("Selamat datang kembali");
      nav(roleHomePath(r.role), { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page nav={false}>
      <TopBar back="/" title="Masuk ke Akun" sub="Gunakan NIM (penghuni) atau username (penjaga / admin)" />

      <Stagger className="mt-2">
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field
              label="NIM atau Username"
              placeholder="Contoh: 105022010101 atau marten.lengkong"
              autoComplete="username"
              icon={<UserIcon className="size-4" />}
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setErr(null);
              }}
            />

            <Field
              label="Kata Sandi"
              type={show ? "text" : "password"}
              placeholder="Masukkan kata sandi"
              autoComplete="current-password"
              icon={<KeyRound className="size-4" />}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setErr(null);
              }}
              trailing={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Sembunyikan sandi" : "Tampilkan sandi"}
                  className="grid size-8 place-items-center rounded-full text-muted hover:text-ink"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />

            {err && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger-soft p-3.5 text-xs text-danger"
              >
                {err.lockedUntil ? <Lock className="mt-0.5 size-4 shrink-0" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" />}
                <div className="space-y-1">
                  <p className="font-semibold">{err.msg}</p>
                  {err.lockedUntil && err.lockedUntil > Date.now() && (
                    <p className="text-ink">
                      Sisa waktu kunci: <Countdown until={err.lockedUntil} className="font-bold text-danger" />
                    </p>
                  )}
                </div>
              </div>
            )}

            <Button
              type="submit"
              block
              size="lg"
              disabled={submitting}
              icon={<LogIn className="size-4" />}
            >
              {submitting ? "Memverifikasi…" : "Masuk"}
            </Button>
          </form>
        </Card>

        <Item className="mt-5 text-center text-sm text-muted">
          Penghuni baru?{" "}
          <Link to="/daftar" className="font-semibold text-primary hover:underline">
            Daftar dengan NIM resmi
          </Link>
        </Item>
      </Stagger>
    </Page>
  );
}
