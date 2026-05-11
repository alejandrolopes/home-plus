"use client";

import { useState, useTransition } from "react";
import { Check, Link2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDate } from "@/lib/format";
import {
  acceptTransferCreateAction,
  acceptTransferLinkAction,
  rejectTransferAction,
} from "./actions";
import {
  loadCandidatesAction,
  type LinkCandidate,
} from "./load-candidates-action";

type Account = { id: string; name: string; type: string };

type Props = {
  pendingId: string;
  suggestedDestAccountId: string | null;
  accounts: Account[];
};

export function PendingTransferActions({
  pendingId,
  suggestedDestAccountId,
  accounts,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState<string>(
    suggestedDestAccountId ?? accounts[0]?.id ?? "",
  );
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");

  function handleAcceptCreate() {
    const fd = new FormData();
    fd.set("pendingId", pendingId);
    fd.set("destAccountId", accountId);
    startTransition(async () => {
      const res = await acceptTransferCreateAction(fd);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Transferência aceita.");
      setCreateOpen(false);
    });
  }

  function handleAcceptLink() {
    if (!selectedCandidate) {
      toast.error("Selecione um lançamento para vincular.");
      return;
    }
    const fd = new FormData();
    fd.set("pendingId", pendingId);
    fd.set("candidateId", selectedCandidate);
    startTransition(async () => {
      const res = await acceptTransferLinkAction(fd);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Transferência vinculada.");
      setLinkOpen(false);
    });
  }

  function handleReject() {
    if (
      !confirm(
        "Recusar essa transferência? A perna do outro lado vira um lançamento avulso.",
      )
    )
      return;
    const fd = new FormData();
    fd.set("pendingId", pendingId);
    startTransition(async () => {
      const res = await rejectTransferAction(fd);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Transferência recusada.");
    });
  }

  async function openLinkDialog() {
    setLinkOpen(true);
    setSelectedCandidate("");
    setCandidates(null);
    const list = await loadCandidatesAction(pendingId);
    setCandidates(list);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger
          render={
            <Button size="sm" disabled={pending}>
              <Plus className="size-4" />
              Aceitar (criar lançamento)
            </Button>
          }
          nativeButton={false}
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aceitar transferência</DialogTitle>
            <DialogDescription>
              Um lançamento espelho será criado na conta escolhida.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Conta destino</label>
            <Select
              value={accountId}
              onValueChange={(v) => setAccountId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma conta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAcceptCreate}
              disabled={pending || !accountId}
            >
              <Check className="size-4" />
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <Button
          size="sm"
          variant="outline"
          onClick={openLinkDialog}
          disabled={pending}
        >
          <Link2 className="size-4" />
          Aceitar (vincular existente)
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular a um lançamento existente</DialogTitle>
            <DialogDescription>
              Lançamentos seus de mesmo valor, kind oposto, em até 14 dias.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {candidates === null ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum lançamento candidato encontrado.
              </p>
            ) : (
              <ul className="space-y-1">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent">
                      <input
                        type="radio"
                        name="candidate"
                        value={c.id}
                        checked={selectedCandidate === c.id}
                        onChange={() => setSelectedCandidate(c.id)}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {c.description}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(c.occurredOn)} · {c.accountName}
                        </div>
                      </div>
                      <div className="tabular-nums text-sm">
                        {formatBRL(c.amount)}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLinkOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAcceptLink}
              disabled={pending || !selectedCandidate}
            >
              <Check className="size-4" />
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleReject}
        disabled={pending}
      >
        <X className="size-4" />
        Recusar
      </Button>
    </div>
  );
}
