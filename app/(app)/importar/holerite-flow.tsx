"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, FileText, Plus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { flattenForSelect } from "@/lib/categories-display";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createTransactionWithSplitsAction,
  saveSplitsAction,
  type SplitInput,
} from "../lancamentos/split-actions";
import {
  QuickCategoryDialog,
  type QuickCategoryResult,
} from "../categorias/quick-category-dialog";
import {
  parseHoleritesAction,
  type HoleriteCandidate,
  type HoleriteResult,
} from "./holerite-actions";

type Category = {
  id: string;
  name: string;
  kind: "income" | "expense";
  parentId?: string | null;
  color?: string | null;
};

type Account = {
  id: string;
  name: string;
};

type Props = {
  categories: Category[];
  bankAccounts: Account[];
};

const NONE = "none";
const NEW_CATEGORY = "__new_category__";

function suggestCategoryId(
  lineDesc: string,
  kind: "income" | "expense",
  categories: Category[],
  historicalCategoryId?: string,
): string {
  const filtered = categories.filter((c) => c.kind === kind);
  if (historicalCategoryId) {
    const histMatch = filtered.find((c) => c.id === historicalCategoryId);
    if (histMatch) return histMatch.id;
  }
  const lower = lineDesc.toLowerCase();
  const exact = filtered.find((c) => lower.includes(c.name.toLowerCase()));
  if (exact) return exact.id;
  const aliases: Array<{ keys: string[]; cat: string[] }> = [
    { keys: ["dízimo", "dizimo", "donativo"], cat: ["dízimo", "dizimo"] },
    { keys: ["inss", "previdência", "previdencia"], cat: ["previdência", "inss"] },
    { keys: ["irrf", "imposto"], cat: ["imposto", "irrf"] },
    { keys: ["proasa", "saúde", "saude"], cat: ["saúde", "saude"] },
    { keys: ["internet"], cat: ["internet"] },
    { keys: ["climatiz"], cat: ["energia", "climatização"] },
    { keys: ["livro", "didát"], cat: ["livros", "educação"] },
    { keys: ["veículo", "veiculo", "uso do veículo"], cat: ["veículo", "carro", "transporte"] },
    { keys: ["subsistência", "salário", "salario"], cat: ["salário", "salario"] },
  ];
  for (const a of aliases) {
    if (a.keys.some((k) => lower.includes(k))) {
      const match = filtered.find((c) =>
        a.cat.some((cc) => c.name.toLowerCase().includes(cc)),
      );
      if (match) return match.id;
    }
  }
  return NONE;
}

export function HoleriteFlow({ categories, bankAccounts }: Props) {
  const [filename, setFilename] = useState<string[]>([]);
  const [results, setResults] = useState<HoleriteResult[]>([]);
  const [parsing, startParsing] = useTransition();
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParseError(null);
    setResults([]);
    setFilename(Array.from(files).map((f) => f.name));

    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("file", f);

    startParsing(async () => {
      try {
        const { results } = await parseHoleritesAction(fd);
        setResults(results);
      } catch (e) {
        setParseError(
          e instanceof Error ? e.message : "Falha ao processar arquivos.",
        );
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          Importar contra-cheque ASR (PDF)
        </CardTitle>
        <CardDescription>
          Aceita o contra-cheque e/ou o extrato de ajuda de custo. O sistema
          extrai cada linha (provimento/desconto/reembolso) e aplica como
          splits do lançamento correspondente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="holerite-file">PDFs</Label>
          <Input
            id="holerite-file"
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            disabled={parsing}
          />
          {filename.length > 0 ? (
            <p className="text-xs text-muted-foreground mt-2">
              {filename.join(" · ")}
              {parsing ? " · processando..." : ""}
            </p>
          ) : null}
          {parseError ? (
            <p className="text-sm text-destructive mt-2">{parseError}</p>
          ) : null}
        </div>

        {results.map((r, i) => (
          <ResultCard
            key={`${i}-${r.filename}`}
            result={r}
            categories={categories}
            bankAccounts={bankAccounts}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ResultCard({
  result,
  categories,
  bankAccounts,
}: {
  result: HoleriteResult;
  categories: Category[];
  bankAccounts: Account[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState<"existing" | "create">(
    result.candidates.length > 0 ? "existing" : "create",
  );
  const [targetId, setTargetId] = useState<string>(
    result.candidates[0]?.id ?? "",
  );
  const [newAccountId, setNewAccountId] = useState<string>(
    bankAccounts[0]?.id ?? "",
  );
  const [newDate, setNewDate] = useState<string>(
    result.parsed?.depositDate ?? "",
  );
  const defaultDescription =
    result.parsed?.source === "ajuda_custo"
      ? "Ajuda de Custo Mensal ASR"
      : "Salário ASR";
  const [newDescription, setNewDescription] =
    useState<string>(defaultDescription);
  const [extraCategories, setExtraCategories] = useState<Category[]>([]);
  const [newCatLineIdx, setNewCatLineIdx] = useState<number | null>(null);
  const [editLines, setEditLines] = useState(() =>
    (result.parsed?.lines ?? []).map((l) => ({
      kind: l.kind,
      categoryId: suggestCategoryId(
        l.description,
        l.kind,
        categories,
        result.suggestedCategories[l.description],
      ),
      description: l.description,
      amount: l.amount.replace(".", ","),
    })),
  );

  const allCategories = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    return [...categories, ...extraCategories.filter((c) => !seen.has(c.id))];
  }, [categories, extraCategories]);

  const handleCategoryCreated = (cat: QuickCategoryResult) => {
    setExtraCategories((prev) => [...prev, cat]);
    if (newCatLineIdx !== null) {
      setEditLines((prev) =>
        prev.map((x, i) =>
          i === newCatLineIdx ? { ...x, categoryId: cat.id } : x,
        ),
      );
    }
    setNewCatLineIdx(null);
  };

  if (result.error || !result.parsed) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
        <strong>{result.filename}</strong>:{" "}
        {result.error ?? "Não foi possível processar."}
      </div>
    );
  }

  const parsed = result.parsed;

  // Amounts são editados em PT-BR (vírgula). Normaliza pra dot ao calcular
  // ou enviar pro backend.
  const toCents = (v: string): number =>
    Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
  const toDot = (v: string): string =>
    v.replace(/\./g, "").replace(",", ".");

  const totalSigned = editLines.reduce((s, l) => {
    const c = toCents(l.amount);
    return s + (l.kind === "income" ? c : -c);
  }, 0);
  const expectedSigned = Math.round(Number(parsed.liquido) * 100);
  const diff = totalSigned - expectedSigned;
  const isBalanced = Math.abs(diff) <= 1;

  const apply = () => {
    setError(null);
    const splits: SplitInput[] = editLines.map((l) => ({
      kind: l.kind,
      categoryId: l.categoryId === NONE ? null : l.categoryId,
      description: l.description.trim() || null,
      amount: toDot(l.amount),
    }));
    if (mode === "existing") {
      if (!targetId) return;
      startTransition(async () => {
        const r = await saveSplitsAction(targetId, splits);
        if ("error" in r) setError(r.error);
        else setDone(true);
      });
    } else {
      if (!newAccountId || !newDate || !newDescription || !parsed) return;
      startTransition(async () => {
        const r = await createTransactionWithSplitsAction({
          accountId: newAccountId,
          occurredOn: newDate,
          amount: parsed.liquido,
          description: newDescription,
          kind: "income",
          splits,
        });
        if ("error" in r) setError(r.error);
        else setDone(true);
      });
    }
  };

  if (done) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/20 p-3 text-sm flex items-center gap-2">
        <CheckCircle2 className="size-4 text-emerald-600" />
        <strong>{result.filename}</strong>: splits aplicados (
        {editLines.length} linhas).
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <strong className="text-sm">{result.filename}</strong>
          <Badge variant="secondary" className="text-[10px]">
            {parsed.source === "contracheque"
              ? "Contra-cheque"
              : "Ajuda de Custo"}
          </Badge>
        </div>
        <div className="text-sm tabular-nums text-muted-foreground">
          Líquido:{" "}
          <span className="font-semibold text-foreground">
            {formatBRL(parsed.liquido)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={result.candidates.length === 0}
            />
            Aplicar em lançamento existente
            {result.candidates.length === 0 ? (
              <span className="text-muted-foreground ml-1">
                (nenhum compatível)
              </span>
            ) : null}
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              checked={mode === "create"}
              onChange={() => setMode("create")}
              disabled={bankAccounts.length === 0}
            />
            Criar novo lançamento agora
          </label>
        </div>

        {mode === "existing" ? (
          <Select value={targetId} onValueChange={(v) => setTargetId(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v) => {
                  const c = result.candidates.find((x) => x.id === v);
                  if (!c) return "Selecione";
                  return `${c.description} · ${formatDate(`${c.occurredOn}T00:00:00`)} · ${c.accountName}`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {result.candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.description} ·{" "}
                  {formatDate(`${c.occurredOn}T00:00:00`)} · {c.accountName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-2 bg-background">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Descrição</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Ex: Salário ASR"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Conta de depósito</Label>
              <Select
                value={newAccountId}
                onValueChange={(v) => setNewAccountId(v ?? "")}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue>
                    {(v) =>
                      bankAccounts.find((a) => a.id === v)?.name ?? "Selecione"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Data {parsed.depositDate ? "(detectada do PDF)" : ""}
              </Label>
              <Input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Valor (líquido)</Label>
              <Input
                value={formatBRL(parsed.liquido)}
                disabled
                className="h-8 text-xs text-right tabular-nums"
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr className="border-b text-muted-foreground">
              <th className="px-2 py-1.5 text-left font-normal w-20">
                Tipo
              </th>
              <th className="px-2 py-1.5 text-left font-normal w-44">
                Categoria
              </th>
              <th className="px-2 py-1.5 text-left font-normal">Descrição</th>
              <th className="px-2 py-1.5 text-right font-normal w-24">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {editLines.map((l, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="px-2 py-1">
                  <Select
                    value={l.kind}
                    onValueChange={(v) => {
                      const newKind = (v ?? "expense") as
                        | "income"
                        | "expense";
                      setEditLines((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                kind: newKind,
                                categoryId: NONE,
                              }
                            : x,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue>
                        {(v) =>
                          v === "income" ? "Provento" : "Desconto"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Provento</SelectItem>
                      <SelectItem value="expense">Desconto</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={l.categoryId}
                    onValueChange={(v) => {
                      if (v === NEW_CATEGORY) {
                        setNewCatLineIdx(idx);
                        return;
                      }
                      setEditLines((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, categoryId: v ?? NONE } : x,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue>
                        {(v) => {
                          if (!v || v === NONE) return "Sem categoria";
                          return (
                            allCategories.find((c) => c.id === v)?.name ??
                            "Sem categoria"
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sem categoria</SelectItem>
                      {flattenForSelect(allCategories, l.kind).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span
                            className={cn(
                              "flex items-center gap-1.5",
                              c.depth === 1 && "pl-3",
                            )}
                          >
                            {c.depth === 1 ? (
                              <span
                                aria-hidden
                                className="text-muted-foreground/60"
                              >
                                ↳
                              </span>
                            ) : null}
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem
                        value={NEW_CATEGORY}
                        className="text-primary border-t mt-1 pt-1.5"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Plus className="size-3.5" />
                          Nova categoria
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={l.description}
                    onChange={(e) =>
                      setEditLines((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, description: e.target.value }
                            : x,
                        ),
                      )
                    }
                    className="h-7 text-xs"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={l.amount}
                    onChange={(e) =>
                      setEditLines((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, amount: e.target.value }
                            : x,
                        ),
                      )
                    }
                    className="h-7 text-xs text-right tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <span
          className={cn(
            "tabular-nums font-medium px-2 py-0.5 rounded-md",
            isBalanced
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
              : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
          )}
        >
          {isBalanced
            ? "🟢 Balanceado"
            : `🔴 Diverge em ${formatBRL((Math.abs(diff) / 100).toFixed(2))}`}
        </span>
        <Button
          size="sm"
          onClick={apply}
          disabled={
            pending ||
            !isBalanced ||
            (mode === "existing" && !targetId) ||
            (mode === "create" &&
              (!newAccountId || !newDate || !newDescription))
          }
        >
          {pending
            ? mode === "create"
              ? "Criando..."
              : "Aplicando..."
            : mode === "create"
              ? "Criar e aplicar splits"
              : "Aplicar splits"}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <QuickCategoryDialog
        open={newCatLineIdx !== null}
        onOpenChange={(o) => {
          if (!o) setNewCatLineIdx(null);
        }}
        kind={
          newCatLineIdx !== null
            ? editLines[newCatLineIdx]?.kind ?? "expense"
            : "expense"
        }
        onCreated={handleCategoryCreated}
        parents={allCategories.filter((c) => !c.parentId)}
      />
    </div>
  );
}
