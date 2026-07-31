import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isElectron } from "@/lib/electron";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [restarting, setRestarting] = useState(false);
  const { data: dataRoot, refetch } = useQuery({
    queryKey: ["electron-data-root"],
    queryFn: () => window.electronAPI!.getDataRoot(),
    enabled: open && isElectron(),
  });

  const changeFolder = async () => {
    const picked = await window.electronAPI!.pickDataFolder();
    if (!picked) return;
    setRestarting(true);
    try {
      await window.electronAPI!.setDataRoot(picked);
      await refetch();
      toast.success("Pasta de dados atualizada — reiniciando a API…");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>
            Pasta onde os apps configurados, manifests, scripts do k6 e resultados de execuções ficam salvos.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all">
          {dataRoot ?? "carregando…"}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={restarting} onClick={changeFolder}>
            {restarting ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
            Trocar pasta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
