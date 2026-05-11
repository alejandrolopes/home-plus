"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDate } from "@/lib/format";
import { parseCsv } from "@/lib/import/csv-parser";
import { parseOfx } from "@/lib/import/ofx-parser";
import type {
  ImportAccountKind,
  ParsedImport,
  ParsedTransaction,
} from "@/lib/import/types";
import { cn } from "@/lib/utils";
import { confirmImportAction, type ConfirmImportState } from "./actions";

type Account = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
};

type Props = {
  accounts: Account[];
};

type ParseError = { message: string } | null;

function compatibleAccounts(
  accounts: Account[],
  kind: ImportAccountKind,
): Account[] {
  if (kind === "credit_card")
    return accounts.filter((a) => a.type === "credit_card");
  return accounts.filter((a) => a.type !== "credit_card");
}

export function ImportFlow({ accounts }: Props) {
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseError, setParseError] = useState<ParseError>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [accountId, setAccountId] = useState<string>("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<
    ConfirmImportState,
    FormData
  >(confirmImportAction, null);

  const compatible = useMemo(
    () => (parsed ? compatibleAccounts(accounts, parsed.accountKind) : []),
    [accounts, parsed],
  );

  const handleFile = async (file: File) => {
    setParseError(null);
    setParsed(null);
    setSkip(new Set());
    setFilename(file.name);
    const text = await file.text();
    try {
      const isOfx =
        file.name.toLowerCase().endsWith(".ofx") ||
        text.includes("OFXHEADER") ||
        text.includes("<OFX>");
      const result = isOfx ? parseOfx(text) : parseCsv(text);
      if (result.transactions.length === 0) {
        setParseError({ message: "Nenhuma transação encontrada no arquivo." });
        return;
      }
      setParsed(result);

      // Auto-skip "Pagamento recebido" by default for credit_card view? No.
      // Action handles them as match/pending automatically; user can still uncheck.

      const compat = compatibleAccounts(accounts, result.accountKind);
      if (compat.length === 0) setMode("new");
      else {
        setMode("existing");
        setAccountId(compat[0].id);
      }
    } catch (e) {
      setParseError({
        message: e instanceof Error ? e.message : "Falha ao processar arquivo.",
      });
    }
  };

  const selectedTxs = useMemo(() => {
    if (!parsed) return [] as ParsedTransaction[];
    return parsed.transactions.filter(
      (t) => !t.externalId || !skip.has(t.externalId),
    );
  }, [parsed, skip]);

  const sumSelected = useMemo(() => {
    let cents = 0;
    for (const t of selectedTxs) {
      const c = Math.round(Number(t.amount) * 100);
      cents += t.kind === "income" ? c : -c;
    }
    return (cents / 100).toFixed(2);
  }, [selectedTxs]);

  const sumAll = useMemo(() => {
    if (!parsed) return "0";
    let cents = 0;
    for (const t of parsed.transactions) {
      const c = Math.round(Number(t.amount) * 100);
      cents += t.kind === "income" ? c : -c;
    }
    return (cents / 100).toFixed(2);
  }, [parsed]);

  const inferredOpening = useMemo(() => {
    if (!parsed?.metadata?.closingBalance || parsed.accountKind !== "bank")
      return "";
    const closing = Math.round(Number(parsed.metadata.closingBalance) * 100);
    const sumAllCents = Math.round(Number(sumAll) * 100);
    return ((closing - sumAllCents) / 100).toFixed(2).replace(".", ",");
  }, [parsed, sumAll]);

  const toggleSkip = (id: string | null) => {
    if (!id) return;
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const paymentsReceived = useMemo(
    () => parsed?.transactions.filter((t) => t.isPaymentReceived) ?? [],
    [parsed],
  );
  const installments = useMemo(
    () => parsed?.transactions.filter((t) => t.installmentNumber != null) ?? [],
    [parsed],
  );

  useEffect(() => {
    if (state?.success) {
      setParsed(null);
      setFilename(null);
      setSkip(new Set());
    }
  }, [state]);

  if (state?.success) {
    return (
      <Card className="border-emerald-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Importação concluída
          </CardTitle>
          <CardDescription className="space-y-0.5">
            <div>
              {state.success.imported} lançamento
              {state.success.imported === 1 ? "" : "s"} importado
              {state.success.imported === 1 ? "" : "s"}
              {state.success.reimported > 0
                ? ` · ${state.success.reimported} substituído${state.success.reimported === 1 ? "" : "s"}`
                : ""}
              {state.success.duplicates > 0
                ? ` · ${state.success.duplicates} duplicado${state.success.duplicates === 1 ? "" : "s"} ignorado${state.success.duplicates === 1 ? "" : "s"}`
                : ""}
              {state.success.accountCreated ? " · Nova conta criada" : ""}
            </div>
            {state.success.paymentsLinked > 0 ? (
              <div className="text-emerald-700 dark:text-emerald-500">
                🟢 {state.success.paymentsLinked} pagamento
                {state.success.paymentsLinked === 1 ? "" : "s"} vinculado
                {state.success.paymentsLinked === 1 ? "" : "s"} automaticamente a
                fatura{state.success.paymentsLinked === 1 ? "" : "s"} paga
                {state.success.paymentsLinked === 1 ? "" : "s"}
              </div>
            ) : null}
            {state.success.paymentsPending > 0 ? (
              <div className="text-amber-700 dark:text-amber-500">
                🟡 {state.success.paymentsPending} pagamento
                {state.success.paymentsPending === 1 ? "" : "s"} sem fatura
                compatível — registrado{state.success.paymentsPending === 1 ? "" : "s"}{" "}
                como pendência
                {state.success.paymentsPending === 1 ? "" : "s"} pra resolver
              </div>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={() => location.reload()}>
            Importar outro arquivo
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              location.href = "/lancamentos";
            }}
          >
            Ver lançamentos
          </Button>
          {state.success.paymentsPending > 0 ? (
            <Button
              variant="outline"
              onClick={() => {
                location.href = "/cartoes";
              }}
            >
              Ver pendências
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            1. Selecione o arquivo
          </CardTitle>
          <CardDescription>OFX ou CSV exportado pelo seu banco.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="file"
            accept=".ofx,.csv,.OFX,.CSV"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {filename ? (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <FileText className="size-3" /> {filename}
              {parsed ? (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {parsed.accountKind === "credit_card"
                    ? "Cartão de crédito"
                    : "Conta bancária"}
                </Badge>
              ) : null}
            </p>
          ) : null}
          {parseError ? (
            <p className="text-sm text-destructive mt-2">
              {parseError.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {parsed ? (
        <form action={action} className="space-y-6">
          <input type="hidden" name="source" value={parsed.source} />
          <input type="hidden" name="accountKind" value={parsed.accountKind} />
          <input type="hidden" name="filename" value={filename ?? ""} />
          <input
            type="hidden"
            name="periodStart"
            value={parsed.periodStart ?? ""}
          />
          <input
            type="hidden"
            name="periodEnd"
            value={parsed.periodEnd ?? ""}
          />
          <input
            type="hidden"
            name="transactions"
            value={JSON.stringify(selectedTxs)}
          />
          <input type="hidden" name="mode" value={mode} />
          {mode === "existing" ? (
            <input type="hidden" name="accountId" value={accountId} />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>2. Conta de destino</CardTitle>
              <CardDescription>
                {parsed.accountKind === "credit_card"
                  ? "Detectamos um extrato de cartão. Selecione um cartão existente ou crie um novo."
                  : "Detectamos um extrato bancário. Selecione conta corrente/poupança ou crie nova."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="_mode"
                    checked={mode === "existing"}
                    onChange={() => setMode("existing")}
                    disabled={compatible.length === 0}
                  />
                  Importar para{" "}
                  {parsed.accountKind === "credit_card"
                    ? "cartão existente"
                    : "conta existente"}
                  {compatible.length === 0 ? (
                    <span className="text-xs text-muted-foreground ml-1">
                      (nenhuma compatível cadastrada)
                    </span>
                  ) : null}
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mode === "new"}
                    onChange={(e) =>
                      setMode(e.target.checked ? "new" : "existing")
                    }
                  />
                  Criar{" "}
                  {parsed.accountKind === "credit_card"
                    ? "novo cartão"
                    : "nova conta"}{" "}
                  a partir deste extrato
                </label>
              </div>

              {mode === "existing" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="accountSelect">
                    {parsed.accountKind === "credit_card"
                      ? "Cartão"
                      : "Conta"}
                  </Label>
                  <Select
                    value={accountId}
                    onValueChange={(v) => setAccountId(v ?? "")}
                  >
                    <SelectTrigger id="accountSelect" className="w-full">
                      <SelectValue>
                        {(v) =>
                          compatible.find((a) => a.id === v)?.name ??
                          "Selecione"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {compatible.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.bankName ? ` · ${a.bankName}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : parsed.accountKind === "credit_card" ? (
                <NewCardFields metadata={parsed.metadata} />
              ) : (
                <NewBankFields
                  metadata={parsed.metadata}
                  inferredOpening={inferredOpening}
                />
              )}
            </CardContent>
          </Card>

          {parsed.accountKind === "credit_card" &&
          (paymentsReceived.length > 0 || installments.length > 0) ? (
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="text-base">Detectado neste extrato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {paymentsReceived.length > 0 ? (
                  <div>
                    <strong>{paymentsReceived.length} pagamento(s) recebido(s)</strong>
                    {" "}— vamos tentar vincular automaticamente com faturas pagas
                    de mesmo valor. Sem match, vira pendência.
                  </div>
                ) : null}
                {installments.length > 0 ? (
                  <div>
                    <strong>{installments.length} parcela(s)</strong> identificadas. Cada parcela
                    será importada individualmente (agrupamento futuro).
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>3. Pré-visualização</CardTitle>
              <CardDescription>
                {parsed.periodStart && parsed.periodEnd ? (
                  <>
                    Período {formatDate(`${parsed.periodStart}T00:00:00`)} a{" "}
                    {formatDate(`${parsed.periodEnd}T00:00:00`)} ·{" "}
                  </>
                ) : null}
                {parsed.transactions.length} transaç
                {parsed.transactions.length === 1 ? "ão" : "ões"} ·{" "}
                {selectedTxs.length} selecionada
                {selectedTxs.length === 1 ? "" : "s"} · Total{" "}
                <span
                  className={cn(
                    "tabular-nums font-medium",
                    Number(sumSelected) >= 0
                      ? "text-emerald-600"
                      : "text-rose-600",
                  )}
                >
                  {formatBRL(sumSelected)}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-24">Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.transactions.map((t, i) => {
                      const skipped = !!t.externalId && skip.has(t.externalId);
                      return (
                        <TableRow
                          key={t.externalId ?? `${i}-${t.occurredOn}`}
                          className={skipped ? "opacity-50" : ""}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={!skipped}
                              onChange={() => toggleSkip(t.externalId)}
                              disabled={!t.externalId}
                              className="size-4 accent-primary"
                              title={
                                !t.externalId
                                  ? "Sem identificador único — sempre importada"
                                  : undefined
                              }
                            />
                          </TableCell>
                          <TableCell className="tabular-nums text-xs text-muted-foreground">
                            {formatDate(`${t.occurredOn}T00:00:00`)}
                          </TableCell>
                          <TableCell className="text-sm max-w-md">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="truncate">{t.description}</span>
                              {t.isPaymentReceived ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-500"
                                >
                                  Pagamento — auto-link
                                </Badge>
                              ) : null}
                              {t.installmentNumber != null ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {t.installmentNumber}/{t.installmentTotal}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums font-medium",
                              t.kind === "income"
                                ? "text-emerald-600"
                                : "text-rose-600",
                            )}
                          >
                            {t.kind === "income" ? "+" : "−"}
                            {formatBRL(t.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {state?.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {state.error}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="inline-flex items-start gap-2 text-sm cursor-pointer select-none max-w-md">
              <input
                type="checkbox"
                name="reimport"
                className="mt-0.5 size-4 rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">Reimportar</span> — apaga
                lançamentos existentes deste arquivo e refaz cálculo de fatura
                e período. Use pra corrigir imports antigos.
              </span>
            </label>
            <Button
              type="submit"
              disabled={pending || selectedTxs.length === 0}
            >
              {pending
                ? "Importando..."
                : `Importar ${selectedTxs.length} lançamento${selectedTxs.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function NewBankFields({
  metadata,
  inferredOpening,
}: {
  metadata: ParsedImport["metadata"];
  inferredOpening: string;
}) {
  const defaultName = metadata?.bankName
    ? `${metadata.bankName.split(" ")[0]} Conta Corrente`
    : "Nova conta corrente";

  return (
    <div className="space-y-3 rounded-md border p-3 bg-background">
      <Badge variant="secondary" className="font-normal">
        Criando nova conta
      </Badge>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="newName">Nome da conta</Label>
          <Input
            id="newName"
            name="newName"
            defaultValue={defaultName}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newType">Tipo</Label>
          <Select name="newType" defaultValue="checking">
            <SelectTrigger id="newType" className="w-full">
              <SelectValue>
                {(v) => (v === "savings" ? "Poupança" : "Conta corrente")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="checking">Conta corrente</SelectItem>
              <SelectItem value="savings">Poupança</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newColor">Cor</Label>
          <Input
            id="newColor"
            name="newColor"
            type="color"
            defaultValue="#8b5cf6"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newBankName">Banco</Label>
          <Input
            id="newBankName"
            name="newBankName"
            defaultValue={metadata?.bankName ?? ""}
            placeholder="Ex: Nubank"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newBankId">Código (FID)</Label>
          <Input
            id="newBankId"
            name="newBankId"
            defaultValue={metadata?.bankId ?? ""}
            placeholder="260"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newAccountBranch">Agência</Label>
          <Input
            id="newAccountBranch"
            name="newAccountBranch"
            defaultValue={metadata?.accountBranch ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newAccountNumber">Número da conta</Label>
          <Input
            id="newAccountNumber"
            name="newAccountNumber"
            defaultValue={metadata?.accountNumber ?? ""}
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="newInitialBalance">Saldo inicial</Label>
          <MoneyInput
            id="newInitialBalance"
            name="newInitialBalance"
            defaultValue={inferredOpening || "0"}
            allowNegative
            className="text-right tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            Saldo antes do extrato começar.
            {inferredOpening
              ? ` Calculado: ${formatBRL(inferredOpening)} (saldo final − soma das transações).`
              : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function NewCardFields({
  metadata,
}: {
  metadata: ParsedImport["metadata"];
}) {
  const defaultName = metadata?.bankName
    ? `${metadata.bankName.split(" ")[0]} Cartão`
    : "Novo cartão";

  return (
    <div className="space-y-3 rounded-md border p-3 bg-background">
      <Badge variant="secondary" className="font-normal">
        Criando novo cartão
      </Badge>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="newName">Nome do cartão</Label>
          <Input
            id="newName"
            name="newName"
            defaultValue={defaultName}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newClosingDay">Dia do fechamento</Label>
          <Input
            id="newClosingDay"
            name="newClosingDay"
            type="number"
            min={1}
            max={31}
            defaultValue={5}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newDueDay">Dia do vencimento</Label>
          <Input
            id="newDueDay"
            name="newDueDay"
            type="number"
            min={1}
            max={31}
            defaultValue={12}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newCreditLimit">Limite</Label>
          <MoneyInput
            id="newCreditLimit"
            name="newCreditLimit"
            defaultValue="0"
            className="text-right tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newColor">Cor</Label>
          <Input
            id="newColor"
            name="newColor"
            type="color"
            defaultValue="#8b5cf6"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newBankName">Banco/Emissor</Label>
          <Input
            id="newBankName"
            name="newBankName"
            defaultValue={metadata?.bankName ?? ""}
            placeholder="Ex: Nubank"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newBankId">Código (FID)</Label>
          <Input
            id="newBankId"
            name="newBankId"
            defaultValue={metadata?.bankId ?? ""}
            placeholder="260"
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="newAccountNumber">ID interno do cartão</Label>
          <Input
            id="newAccountNumber"
            name="newAccountNumber"
            defaultValue={metadata?.accountNumber ?? ""}
            placeholder="Identificador interno (do extrato)"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Os dias de fechamento e vencimento são essenciais pra alocar cada
        compra na fatura correta. Defaults Nubank: 5 e 12 — ajuste se for
        outro emissor.
      </p>
    </div>
  );
}
