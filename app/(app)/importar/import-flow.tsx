"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  HelpCircle,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
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
import {
  flattenForSelect,
  getCategoryDisplayColor,
  type DisplayCategoryBase,
} from "@/lib/categories-display";
import { formatBRL, formatDate } from "@/lib/format";
import { parseCsv } from "@/lib/import/csv-parser";
import { parseOfx } from "@/lib/import/ofx-parser";
import type {
  ImportAccountKind,
  ParsedImport,
  ParsedTransaction,
} from "@/lib/import/types";
import type { Suggestion } from "@/lib/repos/category-suggestions";
import type { RefundCandidate } from "@/lib/repos/refund-detection";
import { cn } from "@/lib/utils";
import { deriveDueDate, derivePeriodFromDueDate } from "@/lib/credit-card";
import {
  confirmImportAction,
  detectAutoLinksAction,
  detectRefundCandidatesAction,
  listInvoicesForImportAction,
  suggestCategoriesBatchAction,
  type ConfirmImportState,
  type DetectedAutoLink,
  type ImportInvoiceOption,
} from "./actions";

type Account = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  closingDay: number | null;
  dueDay: number | null;
};

type CategoryOption = DisplayCategoryBase;

type Props = {
  accounts: Account[];
  categories: CategoryOption[];
};

type ParseError = { message: string } | null;

const NONE_CATEGORY = "__none__";

function txKey(t: ParsedTransaction, idx: number): string {
  // Sempre inclui idx pra evitar colisão quando o OFX traz dois lançamentos
  // com o mesmo FITID (Nubank às vezes faz isso em parcelas). Mantém o
  // externalId no prefixo só pra facilitar debug visual nos logs/maps.
  return t.externalId ? `${t.externalId}-${idx}` : `idx-${idx}`;
}

type CategoryChoice = {
  /** uuid escolhido, ou null = "sem categoria" */
  id: string | null;
  /** true = decisão confirmada (auto-aplicada high ou usuário tocou no select) */
  reviewed: boolean;
};

function compatibleAccounts(
  accounts: Account[],
  kind: ImportAccountKind,
): Account[] {
  if (kind === "credit_card")
    return accounts.filter((a) => a.type === "credit_card");
  return accounts.filter((a) => a.type !== "credit_card");
}

export function ImportFlow({ accounts, categories }: Props) {
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseError, setParseError] = useState<ParseError>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [accountId, setAccountId] = useState<string>("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<
    Map<string, Suggestion | null>
  >(new Map());
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [choices, setChoices] = useState<Map<string, CategoryChoice>>(
    new Map(),
  );
  const [refundCandidates, setRefundCandidates] = useState<RefundCandidate[]>(
    [],
  );
  const [refundSelected, setRefundSelected] = useState<Set<string>>(new Set());
  // Quando true, ignora pendingReviewCount e permite enviar com sugestões
  // automáticas (ou sem categoria) sem confirmar uma a uma.
  const [skipReview, setSkipReview] = useState(false);

  // === Vínculos automáticos detectados (Pagamento recebido → fatura/lançamento) ===
  const [autoLinks, setAutoLinks] = useState<DetectedAutoLink[]>([]);
  // paymentKey → true (confirma vínculo) | false (manda pra pendência)
  const [autoLinkConfirmed, setAutoLinkConfirmed] = useState<
    Map<string, boolean>
  >(new Map());

  // === Fatura alvo (cartão de crédito) ===
  const [invoices, setInvoices] = useState<ImportInvoiceOption[]>([]);
  const [invoiceMode, setInvoiceMode] = useState<"existing" | "new">("existing");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [newInvoiceStart, setNewInvoiceStart] = useState<string>("");
  const [newInvoiceEnd, setNewInvoiceEnd] = useState<string>("");
  const [newInvoiceDue, setNewInvoiceDue] = useState<string>("");
  // Quando true, mostra inputs explícitos pro período do extrato. Quando
  // false (padrão), os períodos são derivados de dueDate + closing/dueDay
  // do cartão automaticamente.
  const [showAdvancedPeriod, setShowAdvancedPeriod] = useState(false);

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
    setSuggestions(new Map());
    setChoices(new Map());
    setRefundCandidates([]);
    setRefundSelected(new Set());
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

  useEffect(() => {
    if (!parsed) return;
    // Pagamento recebido nunca vira transaction (vira match/pending), então
    // não precisa de categoria — pulamos do fetch.
    const items = parsed.transactions
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => !t.isPaymentReceived)
      .map(({ t, idx }) => ({
        key: txKey(t, idx),
        kind: t.kind,
        description: t.description,
      }));
    if (items.length === 0) return;
    let cancelled = false;
    setLoadingSuggestions(true);
    suggestCategoriesBatchAction(items)
      .then((results) => {
        if (cancelled) return;
        const map = new Map<string, Suggestion | null>();
        const initialChoices = new Map<string, CategoryChoice>();
        for (const r of results) {
          map.set(r.key, r.suggestion);
          if (r.suggestion?.confidence === "high") {
            // Confiança alta: aplica e marca como já revisada.
            initialChoices.set(r.key, {
              id: r.suggestion.categoryId,
              reviewed: true,
            });
          } else if (r.suggestion) {
            // Média/baixa: pré-seleciona mas exige confirmação.
            initialChoices.set(r.key, {
              id: r.suggestion.categoryId,
              reviewed: false,
            });
          } else {
            initialChoices.set(r.key, { id: null, reviewed: false });
          }
        }
        setSuggestions(map);
        setChoices(initialChoices);
      })
      .finally(() => {
        if (!cancelled) setLoadingSuggestions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parsed]);

  useEffect(() => {
    if (!parsed) {
      setRefundCandidates([]);
      setRefundSelected(new Set());
      return;
    }
    // Pagamento recebido vira link/pendência, nunca um lançamento normal —
    // ignoramos pra detecção de estorno.
    const items = parsed.transactions
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => !t.isPaymentReceived)
      .map(({ t, idx }) => ({
        key: txKey(t, idx),
        kind: t.kind,
        amount: t.amount,
        description: t.description,
        occurredOn: t.occurredOn,
      }));
    if (items.length === 0) {
      setRefundCandidates([]);
      setRefundSelected(new Set());
      return;
    }
    const effectiveAccountId = mode === "existing" ? accountId : "";
    let cancelled = false;
    detectRefundCandidatesAction({
      accountId: effectiveAccountId,
      items,
    })
      .then((cands) => {
        if (cancelled) return;
        setRefundCandidates(cands);
        // Seleção inicial: high vem marcado, medium/low desmarcado por padrão
        const initial = new Set<string>();
        for (const c of cands) {
          if (c.confidence === "high") initial.add(c.refundKey);
        }
        setRefundSelected(initial);
      })
      .catch(() => {
        if (cancelled) return;
        setRefundCandidates([]);
        setRefundSelected(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, accountId, mode]);

  // === Detecta vínculos automáticos pra "Pagamento recebido" ===
  useEffect(() => {
    if (
      !parsed ||
      parsed.accountKind !== "credit_card" ||
      mode !== "existing" ||
      !accountId
    ) {
      setAutoLinks([]);
      setAutoLinkConfirmed(new Map());
      return;
    }
    const items = parsed.transactions
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.isPaymentReceived && !!t.externalId)
      .map(({ t, idx }) => ({
        key: txKey(t, idx),
        externalId: t.externalId,
        amount: t.amount,
        description: t.description,
        occurredOn: t.occurredOn,
        isPaymentReceived: true,
      }));
    if (items.length === 0) {
      setAutoLinks([]);
      setAutoLinkConfirmed(new Map());
      return;
    }
    let cancelled = false;
    detectAutoLinksAction({ accountId, items })
      .then((list) => {
        if (cancelled) return;
        setAutoLinks(list);
        const initial = new Map<string, boolean>();
        for (const l of list) initial.set(l.paymentKey, true); // pré-marca
        setAutoLinkConfirmed(initial);
      })
      .catch(() => {
        if (cancelled) return;
        setAutoLinks([]);
        setAutoLinkConfirmed(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, accountId, mode]);

  // === Carrega faturas existentes do cartão escolhido e pré-seleciona ===
  useEffect(() => {
    if (
      !parsed ||
      parsed.accountKind !== "credit_card" ||
      mode !== "existing" ||
      !accountId
    ) {
      setInvoices([]);
      setSelectedInvoiceId("");
      return;
    }
    let cancelled = false;
    listInvoicesForImportAction(accountId)
      .then((list) => {
        if (cancelled) return;
        setInvoices(list);

        const refDate =
          parsed.periodEnd || parsed.transactions[0]?.occurredOn || "";
        const match =
          refDate &&
          list.find(
            (i) => refDate >= i.periodStart && refDate <= i.periodEnd,
          );
        if (match) {
          setInvoiceMode("existing");
          setSelectedInvoiceId(match.id);
          return;
        }
        // Sem match: defaulta pra criar nova fatura. Se o OFX traz período,
        // usa dele pra inferir vencimento + período; senão, deixa em branco
        // pra usuário preencher só o vencimento.
        setInvoiceMode("new");
        setSelectedInvoiceId("");
        setShowAdvancedPeriod(false);
        const acc = accounts.find((a) => a.id === accountId);
        const ofxStart = parsed.periodStart || "";
        const ofxEnd = parsed.periodEnd || "";
        setNewInvoiceStart(ofxStart);
        setNewInvoiceEnd(ofxEnd);
        if (ofxEnd && acc?.closingDay && acc?.dueDay) {
          setNewInvoiceDue(deriveDueDate(ofxEnd, acc.closingDay, acc.dueDay));
        } else {
          setNewInvoiceDue("");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setInvoices([]);
        setSelectedInvoiceId("");
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, accountId, mode, accounts]);

  const selectedTxs = useMemo(() => {
    if (!parsed) return [] as ParsedTransaction[];
    return parsed.transactions.filter((t, idx) => !skip.has(txKey(t, idx)));
  }, [parsed, skip]);

  const selectedWithIndex = useMemo(() => {
    if (!parsed) return [] as Array<{ t: ParsedTransaction; idx: number }>;
    return parsed.transactions
      .map((t, idx) => ({ t, idx }))
      .filter(({ t, idx }) => !skip.has(txKey(t, idx)));
  }, [parsed, skip]);

  /** Quantos lançamentos selecionados ainda precisam de confirmação manual. */
  const pendingReviewCount = useMemo(() => {
    let n = 0;
    for (const { t, idx } of selectedWithIndex) {
      if (t.isPaymentReceived) continue;
      const c = choices.get(txKey(t, idx));
      if (!c || !c.reviewed) n++;
    }
    return n;
  }, [selectedWithIndex, choices]);

  /** Array paralelo a selectedTxs com a escolha final de categoria. */
  const categoryOverridesJson = useMemo(() => {
    const arr = selectedWithIndex.map(({ t, idx }) => {
      if (t.isPaymentReceived) return "";
      const c = choices.get(txKey(t, idx));
      return c?.id ?? "";
    });
    return JSON.stringify(arr);
  }, [selectedWithIndex, choices]);

  /** Cópia de selectedTxs com a `key` estável adicionada para o servidor. */
  const selectedTxsWithKey = useMemo(
    () =>
      selectedWithIndex.map(({ t, idx }) => ({ ...t, key: txKey(t, idx) })),
    [selectedWithIndex],
  );

  /** Vínculos automáticos no formato esperado pela action. Quando vazio,
   * o servidor SEMPRE recebe o array (mesmo que vazio) pra desligar o
   * auto-detect legado — assim a decisão sempre é explícita. */
  const autoLinksJson = useMemo(() => {
    const payload = autoLinks.map((l) => ({
      paymentKey: l.paymentKey,
      linkTo: autoLinkConfirmed.get(l.paymentKey)
        ? `${l.candidate.kind}:${l.candidate.id}`
        : null,
    }));
    return JSON.stringify(payload);
  }, [autoLinks, autoLinkConfirmed]);

  const toggleAutoLink = (paymentKey: string) => {
    setAutoLinkConfirmed((prev) => {
      const next = new Map(prev);
      next.set(paymentKey, !next.get(paymentKey));
      return next;
    });
  };

  /** Estornos confirmados pelo usuário, no formato esperado pela action. */
  const refundLinksJson = useMemo(() => {
    const selectedKeys = new Set(
      selectedTxsWithKey.map((t) => t.key),
    );
    const links = refundCandidates
      .filter((c) => refundSelected.has(c.refundKey))
      // Só liga se o estorno está no que vai ser importado de fato
      .filter((c) => selectedKeys.has(c.refundKey))
      // Se o original é intra-batch, ele também precisa estar incluído
      .filter((c) => !c.originalKey || selectedKeys.has(c.originalKey))
      .map((c) => ({
        refundKey: c.refundKey,
        originalKey: c.originalKey,
        originalTransactionId: c.originalTransactionId,
      }));
    return JSON.stringify(links);
  }, [refundCandidates, refundSelected, selectedTxsWithKey]);

  const toggleRefund = (refundKey: string) => {
    setRefundSelected((prev) => {
      const next = new Set(prev);
      if (next.has(refundKey)) next.delete(refundKey);
      else next.add(refundKey);
      return next;
    });
  };

  const setChoice = (key: string, next: CategoryChoice) => {
    setChoices((prev) => {
      const m = new Map(prev);
      m.set(key, next);
      return m;
    });
  };

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

  const toggleSkip = (key: string) => {
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
            {state.success.refundsLinked > 0 ? (
              <div className="text-sky-700 dark:text-sky-400">
                ↩ {state.success.refundsLinked} estorno
                {state.success.refundsLinked === 1 ? "" : "s"} vinculado
                {state.success.refundsLinked === 1 ? "" : "s"} ao débito original
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
            value={JSON.stringify(selectedTxsWithKey)}
          />
          <input
            type="hidden"
            name="categoryOverrides"
            value={categoryOverridesJson}
          />
          <input
            type="hidden"
            name="targetInvoiceId"
            value={
              parsed.accountKind === "credit_card" &&
              mode === "existing" &&
              invoiceMode === "existing"
                ? selectedInvoiceId
                : ""
            }
          />
          <input
            type="hidden"
            name="newInvoicePeriodStart"
            value={
              parsed.accountKind === "credit_card" &&
              mode === "existing" &&
              invoiceMode === "new"
                ? newInvoiceStart
                : ""
            }
          />
          <input
            type="hidden"
            name="newInvoicePeriodEnd"
            value={
              parsed.accountKind === "credit_card" &&
              mode === "existing" &&
              invoiceMode === "new"
                ? newInvoiceEnd
                : ""
            }
          />
          <input
            type="hidden"
            name="newInvoiceDueDate"
            value={
              parsed.accountKind === "credit_card" &&
              mode === "existing" &&
              invoiceMode === "new"
                ? newInvoiceDue
                : ""
            }
          />
          <input
            type="hidden"
            name="autoLinks"
            value={
              parsed.accountKind === "credit_card" && mode === "existing"
                ? autoLinksJson
                : ""
            }
          />
          <input
            type="hidden"
            name="refundLinks"
            value={refundLinksJson}
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

          {parsed.accountKind === "credit_card" && mode === "existing" ? (
            <Card>
              <CardHeader>
                <CardTitle>3. Fatura de destino</CardTitle>
                <CardDescription>
                  Todos os lançamentos deste arquivo vão pra essa fatura,
                  ignorando o cálculo automático por data — assim o total bate
                  com o que o banco fechou.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="_invoiceMode"
                      checked={invoiceMode === "existing"}
                      onChange={() => setInvoiceMode("existing")}
                      disabled={invoices.length === 0}
                    />
                    Usar fatura existente
                    {invoices.length === 0 ? (
                      <span className="text-xs text-muted-foreground ml-1">
                        (nenhuma fatura cadastrada ainda)
                      </span>
                    ) : null}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="_invoiceMode"
                      checked={invoiceMode === "new"}
                      onChange={() => setInvoiceMode("new")}
                    />
                    Criar nova fatura
                  </label>
                </div>

                {invoiceMode === "existing" && invoices.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="invoiceSelect">Fatura</Label>
                    <Select
                      value={selectedInvoiceId}
                      onValueChange={(v) => setSelectedInvoiceId(v ?? "")}
                    >
                      <SelectTrigger id="invoiceSelect" className="w-full">
                        <SelectValue>
                          {(v) => {
                            const inv = invoices.find((i) => i.id === v);
                            if (!inv) return "Selecione";
                            return `${formatDate(`${inv.periodStart}T00:00:00`)} a ${formatDate(`${inv.periodEnd}T00:00:00`)} · venc ${formatDate(`${inv.dueDate}T00:00:00`)} · ${inv.status === "paid" ? "paga" : inv.status === "closed" ? "fechada" : "aberta"}`;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {invoices.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {formatDate(`${inv.periodStart}T00:00:00`)} a{" "}
                            {formatDate(`${inv.periodEnd}T00:00:00`)} · venc{" "}
                            {formatDate(`${inv.dueDate}T00:00:00`)}
                            {" · "}
                            {inv.status === "paid"
                              ? "paga"
                              : inv.status === "closed"
                                ? "fechada"
                                : "aberta"}
                            {" · "}
                            R$ {formatBRL(inv.totalAmount)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {invoiceMode === "new" ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5 max-w-xs">
                      <Label htmlFor="newInvDue" className="text-xs">
                        Vencimento
                      </Label>
                      <Input
                        id="newInvDue"
                        type="date"
                        value={newInvoiceDue}
                        onChange={(e) => {
                          const due = e.target.value;
                          setNewInvoiceDue(due);
                          const acc = accounts.find(
                            (a) => a.id === accountId,
                          );
                          // Sem override avançado, deriva período do
                          // vencimento + config do cartão. Se o usuário
                          // já mexeu no período manualmente, não sobrescreve.
                          if (
                            due &&
                            !showAdvancedPeriod &&
                            acc?.closingDay &&
                            acc?.dueDay
                          ) {
                            const p = derivePeriodFromDueDate(
                              due,
                              acc.closingDay,
                              acc.dueDay,
                            );
                            setNewInvoiceStart(p.periodStart);
                            setNewInvoiceEnd(p.periodEnd);
                          }
                        }}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          const acc = accounts.find(
                            (a) => a.id === accountId,
                          );
                          if (
                            newInvoiceDue &&
                            !showAdvancedPeriod &&
                            acc?.closingDay &&
                            acc?.dueDay
                          ) {
                            const p = derivePeriodFromDueDate(
                              newInvoiceDue,
                              acc.closingDay,
                              acc.dueDay,
                            );
                            return `Período derivado: ${formatDate(`${p.periodStart}T00:00:00`)} a ${formatDate(`${p.periodEnd}T00:00:00`)}`;
                          }
                          return "Período do extrato será derivado do vencimento + fechamento do cartão.";
                        })()}
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none text-muted-foreground hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={showAdvancedPeriod}
                        onChange={(e) =>
                          setShowAdvancedPeriod(e.target.checked)
                        }
                        className="size-3.5 rounded border-border accent-primary"
                      />
                      Definir período do extrato manualmente
                    </label>
                    {showAdvancedPeriod ? (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1.5">
                          <Label htmlFor="newInvStart" className="text-xs">
                            Início do período
                          </Label>
                          <Input
                            id="newInvStart"
                            type="date"
                            value={newInvoiceStart}
                            onChange={(e) => setNewInvoiceStart(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="newInvEnd" className="text-xs">
                            Fim do período (fechamento)
                          </Label>
                          <Input
                            id="newInvEnd"
                            type="date"
                            value={newInvoiceEnd}
                            onChange={(e) => setNewInvoiceEnd(e.target.value)}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

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

          {autoLinks.length > 0 ? (
            <Card className="border-emerald-300">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="size-4" />
                  Vínculos automáticos detectados
                </CardTitle>
                <CardDescription>
                  Pagamentos recebidos no extrato que casaram com fatura paga
                  ou lançamento de pagamento existente. Desmarque o que não
                  for vínculo real — vai pra pendência pra resolver depois.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {autoLinks.map((l) => {
                  const checked = autoLinkConfirmed.get(l.paymentKey) ?? false;
                  return (
                    <label
                      key={l.paymentKey}
                      className={cn(
                        "flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40",
                        checked &&
                          "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAutoLink(l.paymentKey)}
                        className="mt-0.5 size-4 accent-primary"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="text-xs text-muted-foreground">
                          Pagamento recebido em{" "}
                          {formatDate(`${l.paymentOccurredOn}T00:00:00`)} ·
                          R$ {formatBRL(l.paymentAmount)}
                        </div>
                        <div className="text-xs grid grid-cols-[auto_1fr] gap-x-2">
                          <span className="text-muted-foreground">
                            Vincular a:
                          </span>
                          <span className="truncate">
                            {l.candidate.kind === "invoice" ? (
                              <>
                                Fatura venc{" "}
                                {formatDate(
                                  `${l.candidate.dueDate}T00:00:00`,
                                )}{" "}
                                — R$ {formatBRL(l.candidate.totalAmount)}
                              </>
                            ) : (
                              <>
                                Lançamento{" "}
                                {formatDate(
                                  `${l.candidate.occurredOn}T00:00:00`,
                                )}{" "}
                                — R$ {formatBRL(l.candidate.amount)} —{" "}
                                {l.candidate.description.slice(0, 50)}
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {refundCandidates.length > 0 ? (
            <Card className="border-sky-300">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <RotateCcw className="size-4" />
                  Possíveis estornos detectados
                </CardTitle>
                <CardDescription>
                  Vinculamos crédito e débito para que se anulem nos relatórios.
                  Desmarque os que não forem estorno real.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {refundCandidates.map((c) => {
                  const selected = refundSelected.has(c.refundKey);
                  const confLabel =
                    c.confidence === "high"
                      ? "alta"
                      : c.confidence === "medium"
                        ? "média"
                        : "baixa";
                  const confColor =
                    c.confidence === "high"
                      ? "text-emerald-700 dark:text-emerald-500 border-emerald-300"
                      : c.confidence === "medium"
                        ? "text-amber-700 dark:text-amber-500 border-amber-300"
                        : "text-muted-foreground border-border";
                  return (
                    <label
                      key={c.refundKey}
                      className={cn(
                        "flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40",
                        selected && "bg-sky-50 dark:bg-sky-950/30 border-sky-300",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRefund(c.refundKey)}
                        className="mt-0.5 size-4 accent-primary"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px]", confColor)}
                          >
                            confiança {confLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            R$ {formatBRL(c.amount)} · {c.daysDiff} dia
                            {c.daysDiff === 1 ? "" : "s"} de diferença
                            {c.originalTransactionId ? " · original já no histórico" : ""}
                          </span>
                        </div>
                        <div className="text-xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                          <span className="text-muted-foreground">Estorno:</span>
                          <span className="truncate">
                            {formatDate(`${c.refundOccurredOn}T00:00:00`)} ·{" "}
                            {c.refundDescription}
                          </span>
                          <span className="text-muted-foreground">Original:</span>
                          <span className="truncate">
                            {formatDate(`${c.originalOccurredOn}T00:00:00`)} ·{" "}
                            {c.originalDescription}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>4. Pré-visualização</CardTitle>
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
                      <TableHead className="w-64">Categoria</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.transactions.map((t, i) => {
                      const key = txKey(t, i);
                      const skipped = skip.has(key);
                      const sug = suggestions.get(key) ?? null;
                      const choice = choices.get(key);
                      return (
                        <TableRow
                          key={key}
                          className={skipped ? "opacity-50" : ""}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={!skipped}
                              onChange={() => toggleSkip(key)}
                              className="size-4 accent-primary"
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
                          <TableCell className="text-sm">
                            <CategoryPicker
                              t={t}
                              skipped={skipped}
                              loadingSuggestions={loadingSuggestions}
                              suggestion={sug}
                              choice={choice}
                              categories={categories}
                              onChange={(next) => setChoice(key, next)}
                            />
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

          {pendingReviewCount > 0 && !skipReview ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <div>
                <strong>{pendingReviewCount}</strong> lançamento
                {pendingReviewCount === 1 ? "" : "s"} ainda precisa
                {pendingReviewCount === 1 ? "" : "m"} de confirmação da
                categoria. Revise os destacados em amarelo na tabela acima,
                ou marque "Pular revisão" abaixo pra aplicar as sugestões
                automaticamente.
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
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
            <label className="inline-flex items-start gap-2 text-sm cursor-pointer select-none max-w-md">
              <input
                type="checkbox"
                checked={skipReview}
                onChange={(e) => setSkipReview(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">Pular revisão de categorias</span>{" "}
                — aplica as sugestões automáticas (alta/média/baixa
                confiança) sem confirmar uma a uma. Itens sem sugestão entram
                sem categoria e ficam pra revisão depois.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="submit"
              disabled={
                pending ||
                selectedTxs.length === 0 ||
                loadingSuggestions ||
                (pendingReviewCount > 0 && !skipReview)
              }
              title={
                pendingReviewCount > 0 && !skipReview
                  ? `Confirme ${pendingReviewCount} categoria(s) pendente(s) ou marque "Pular revisão"`
                  : undefined
              }
            >
              {pending
                ? "Importando..."
                : loadingSuggestions
                  ? "Carregando sugestões..."
                  : `Importar ${selectedTxs.length} lançamento${selectedTxs.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function CategoryPicker({
  t,
  skipped,
  loadingSuggestions,
  suggestion,
  choice,
  categories,
  onChange,
}: {
  t: ParsedTransaction;
  skipped: boolean;
  loadingSuggestions: boolean;
  suggestion: Suggestion | null;
  choice: CategoryChoice | undefined;
  categories: CategoryOption[];
  onChange: (next: CategoryChoice) => void;
}) {
  // Pagamento recebido nunca vira lançamento → não precisa de categoria.
  if (t.isPaymentReceived) {
    return (
      <span className="text-xs text-muted-foreground italic">—</span>
    );
  }

  if (loadingSuggestions && !choice) {
    return (
      <span className="text-xs text-muted-foreground">
        Carregando sugestão…
      </span>
    );
  }

  const flat = flattenForSelect(categories, t.kind);
  const selectedValue = choice?.id ?? NONE_CATEGORY;
  const reviewed = choice?.reviewed ?? false;
  const needsReview = !reviewed && !skipped;
  const selectedCat = choice?.id
    ? categories.find((c) => c.id === choice.id)
    : null;
  const selectedColor = selectedCat
    ? getCategoryDisplayColor(selectedCat, categories)
    : null;

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selectedValue}
        onValueChange={(v) => {
          onChange({
            id: v === NONE_CATEGORY ? null : v,
            reviewed: true,
          });
        }}
        disabled={skipped}
      >
        <SelectTrigger
          className={cn(
            "h-8 text-xs w-full",
            needsReview &&
              "border-amber-400 dark:border-amber-500 bg-amber-50/70 dark:bg-amber-950/30",
          )}
        >
          <SelectValue>
            {(v) => {
              if (v === NONE_CATEGORY || !v) {
                return (
                  <span className="text-muted-foreground">Sem categoria</span>
                );
              }
              const cat = categories.find((c) => c.id === v);
              if (!cat) return "Selecione";
              return (
                <span className="inline-flex items-center gap-1.5">
                  {selectedColor ? (
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ background: selectedColor }}
                    />
                  ) : null}
                  <span className="truncate">{cat.name}</span>
                </span>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_CATEGORY}>Sem categoria</SelectItem>
          {flat.map((c) => {
            const color = getCategoryDisplayColor(c, categories);
            return (
              <SelectItem key={c.id} value={c.id}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    c.depth === 1 && "pl-3",
                  )}
                >
                  {color ? (
                    <span
                      aria-hidden
                      className="inline-block size-2 rounded-full"
                      style={{ background: color }}
                    />
                  ) : null}
                  <span>{c.name}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <ConfidenceBadge
        suggestion={suggestion}
        reviewed={reviewed}
        skipped={skipped}
      />
    </div>
  );
}

function ConfidenceBadge({
  suggestion,
  reviewed,
  skipped,
}: {
  suggestion: Suggestion | null;
  reviewed: boolean;
  skipped: boolean;
}) {
  if (skipped) return null;
  if (suggestion?.confidence === "high" && reviewed) {
    return (
      <span
        title="Sugerido automaticamente com alta confiança"
        className="text-emerald-600 dark:text-emerald-500"
      >
        <Sparkles className="size-3.5" />
      </span>
    );
  }
  if (!reviewed) {
    if (!suggestion) {
      return (
        <span
          title="Sem sugestão — escolha uma categoria"
          className="text-amber-600 dark:text-amber-500"
        >
          <HelpCircle className="size-3.5" />
        </span>
      );
    }
    return (
      <span
        title={`Sugestão de confiança ${suggestion.confidence === "medium" ? "média" : "baixa"} — confirme`}
        className="text-amber-600 dark:text-amber-500"
      >
        <AlertTriangle className="size-3.5" />
      </span>
    );
  }
  return null;
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
