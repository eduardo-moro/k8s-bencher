import { Sparkles, FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function StepStart({
  onPickBlank,
  onPickExample,
  loadingExample,
}: {
  onPickBlank: () => void;
  onPickExample: () => void;
  loadingExample: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card
        className="cursor-pointer transition-colors hover:border-primary"
        onClick={onPickBlank}
      >
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <FilePlus2 className="size-6 text-muted-foreground" />
          <p className="font-medium">Começar do zero</p>
          <p className="text-xs text-muted-foreground">
            Você preenche cada campo do seu jeito, passo a passo.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onPickBlank}>
            Começar do zero
          </Button>
        </CardContent>
      </Card>
      <Card
        className="cursor-pointer transition-colors hover:border-primary"
        onClick={onPickExample}
      >
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <Sparkles className="size-6 text-muted-foreground" />
          <p className="font-medium">Usar o exemplo httpbin</p>
          <p className="text-xs text-muted-foreground">
            Não sabe por onde começar? Comece pelo exemplo pronto e ajuste depois.
          </p>
          <Button type="button" size="sm" disabled={loadingExample} onClick={onPickExample}>
            {loadingExample ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Usar o exemplo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
