import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Hash, KeyRound, ShieldAlert, UserCheck, UserPlus } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Button, Card, Field, Item, Stagger } from "../../components/ui";
import { useAuth, useToast } from "../../state/app";

export default function Register() {
  const [nim, setNim] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { registerResident } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErr(null);
    setFieldErrors({});

    const cleanNim = nim.trim();
    const cleanName = name.trim();
    if (!cleanNim || cleanNim.length < 5) {
      setFieldErrors({ nim: "NIM wajib diisi (minimal 5 karakter)." });
      return;
    }
    if (!cleanName || cleanName.length < 2) {
      setFieldErrors({ fullName: "Nama lengkap wajib diisi sesuai data akademik." });
      return;
    }
    if (pw.length < 8) {
      setFieldErrors({ password: "Kata sandi minimal 8 karakter." });
      return;
    }
    if (pw !== pw2) {
      setErr("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await registerResident({
        nim: cleanNim,
        fullName: cleanName,
        password: pw,
      });

      if (!res.ok) {
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        setErr(res.error);
        return;
      }

      toast("Akun penghuni berhasil dibuat");
      nav("/penghuni", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page nav={false}>
      <TopBar back="/" title="Pendaftaran Penghuni" sub="Hanya NIM resmi asrama yang dapat mendaftar" />

      <Stagger className="mt-2">
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-3.5" noValidate>
            <Field
              label="NIM Resmi Asrama"
              placeholder="Contoh: 105022010105"
              inputMode="numeric"
              icon={<Hash className="size-4" />}
              value={nim}
              error={fieldErrors.nim}
              onChange={(e) => {
                setNim(e.target.value.replace(/\s+/g, ""));
                setErr(null);
                setFieldErrors((f) => ({ ...f, nim: "" }));
              }}
              hint="NIM diverifikasi langsung terhadap daftar penghuni resmi asrama saat disimpan."
            />

            <Field
              label="Nama Lengkap"
              placeholder="Sesuai data akademik UNKLAB"
              icon={<UserCheck className="size-4" />}
              value={name}
              error={fieldErrors.fullName}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
                setFieldErrors((f) => ({ ...f, fullName: "" }));
              }}
            />

            <Field
              label="Buat Kata Sandi"
              type="password"
              placeholder="Minimal 8 karakter"
              icon={<KeyRound className="size-4" />}
              value={pw}
              error={fieldErrors.password}
              onChange={(e) => {
                setPw(e.target.value);
                setErr(null);
                setFieldErrors((f) => ({ ...f, password: "" }));
              }}
            />

            <Field
              label="Ulangi Kata Sandi"
              type="password"
              placeholder="Ketik ulang kata sandi"
              icon={<KeyRound className="size-4" />}
              value={pw2}
              onChange={(e) => {
                setPw2(e.target.value);
                setErr(null);
              }}
            />

            {err && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger-soft p-3.5 text-xs text-danger"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span className="font-semibold">{err}</span>
              </div>
            )}

            <Button
              type="submit"
              block
              size="lg"
              disabled={submitting}
              icon={<UserPlus className="size-4" />}
            >
              {submitting ? "Memproses pendaftaran…" : "Buat Akun Penghuni"}
            </Button>
          </form>
        </Card>

        <Card className="mt-4 p-4">
          <p className="eyebrow">Ketentuan Pendaftaran (P-01)</p>
          <ul className="mt-2 space-y-1.5 text-xs text-muted">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden />
              NIM harus terdaftar aktif pada daftar resmi penghuni asrama.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden />
              Setiap NIM hanya dapat didaftarkan untuk satu akun penghuni.
            </li>
          </ul>
        </Card>

        <Item className="mt-4 text-center text-sm text-muted">
          Sudah punya akun?{" "}
          <Link to="/masuk" className="font-semibold text-primary hover:underline">
            Masuk di sini
          </Link>
        </Item>
      </Stagger>
    </Page>
  );
}
