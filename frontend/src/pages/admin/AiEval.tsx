import { useNavigate } from "react-router-dom";
import { Cpu } from "lucide-react";
import { Page, TopBar } from "../../components/layout";
import { Button, Card } from "../../components/ui";

export default function AiEval() {
  const nav = useNavigate();

  return (
    <Page nav={false}>
      <TopBar back="/admin" title="Evaluasi AI" sub="Metrik validasi biometrik" />
      <Card className="mt-8 space-y-4 p-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Cpu className="size-7" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">Log Validasi Biometrik Nyata</h2>
        <p className="text-xs text-muted">
          Skor kecocokan ArcFace, skor liveness PAD, dan alasan penolakan setiap percobaan scan tercatat secara langsung pada menu Log Validasi AI.
        </p>
        <Button block onClick={() => nav("/admin/log")}>
          Buka Log Validasi AI
        </Button>
      </Card>
    </Page>
  );
}
