"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { lightenHex } from "@/lib/categories-display";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ReportGroup = {
  rootId: string | null;
  rootName: string;
  rootColor: string | null;
  directTotal: number;
  childrenTotal: number;
  total: number;
  children: Array<{
    id: string;
    name: string;
    color: string | null;
    total: number;
  }>;
};

export function CategoryBreakdownCard({
  title,
  icon,
  groups,
  total,
  tone,
  from,
  to,
}: {
  title: string;
  icon: React.ReactNode;
  groups: ReportGroup[];
  total: number;
  tone: "income" | "expense";
  from: string;
  to: string;
}) {
  const fallbackBar =
    tone === "income" ? "rgb(16 185 129)" : "rgb(244 63 94)";
  const valueClass =
    tone === "income" ? "text-emerald-600" : "text-rose-600";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum lançamento neste mês.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {groups.map((g) => (
              <GroupRow
                key={g.rootId ?? "__none__"}
                group={g}
                total={total}
                fallbackBar={fallbackBar}
                valueClass={valueClass}
                from={from}
                to={to}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function GroupRow({
  group,
  total,
  fallbackBar,
  valueClass,
  from,
  to,
}: {
  group: ReportGroup;
  total: number;
  fallbackBar: string;
  valueClass: string;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const pct = total > 0 ? (group.total / total) * 100 : 0;
  const color = group.rootColor ?? fallbackBar;
  const hasDetail =
    group.children.length > 0 ||
    (group.directTotal > 0 && group.children.length > 0);
  const expandable = group.children.length > 0;

  const subItems: Array<{
    key: string;
    id: string | null; // null = pseudo entry "diretos"
    name: string;
    color: string | null;
    total: number;
    italic?: boolean;
  }> = [];
  if (group.directTotal > 0 && group.children.length > 0) {
    subItems.push({
      key: "__direct__",
      id: group.rootId, // link pra mãe (filtro estrito de subs incluída cobre)
      name: `(diretos em ${group.rootName})`,
      color: null,
      total: group.directTotal,
      italic: true,
    });
  }
  for (const c of group.children) {
    subItems.push({
      key: c.id,
      id: c.id,
      name: c.name,
      color: c.color,
      total: c.total,
    });
  }
  subItems.sort((a, b) => b.total - a.total);

  const lancamentosHref = (catId: string | null) =>
    catId
      ? `/lancamentos?category=${catId}&from=${from}&to=${to}`
      : `/lancamentos?from=${from}&to=${to}`;

  return (
    <li className="space-y-1">
      <div
        className={cn(
          "w-full flex items-center justify-between gap-2 text-sm rounded-md py-0.5 px-1 -mx-1",
          "hover:bg-muted/40",
        )}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Recolher" : "Expandir"}
            className="shrink-0 -m-1 p-1 rounded hover:bg-muted/60"
          >
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <Link
          href={lancamentosHref(group.rootId)}
          className="flex flex-1 items-center justify-between gap-2 min-w-0"
          title={`Ver lançamentos${group.rootId ? ` de ${group.rootName}` : " sem categoria"} no mês`}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <span
              aria-hidden
              className="size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="truncate text-left">{group.rootName}</span>
          </span>
          <span className="flex items-center gap-2 tabular-nums shrink-0">
            <span className="text-xs text-muted-foreground">
              {pct.toFixed(1)}%
            </span>
            <span className={cn("font-medium", valueClass)}>
              {formatBRL(group.total.toFixed(2))}
            </span>
          </span>
        </Link>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(pct, 1.5)}%`,
            backgroundColor: color,
          }}
        />
      </div>

      {expandable && open && hasDetail ? (
        <ul className="pl-6 pt-1 space-y-1">
          {subItems.map((it) => {
            const subPct = group.total > 0 ? (it.total / group.total) * 100 : 0;
            const subColor = it.key === "__direct__" ? color : lightenHex(color);
            return (
              <li key={it.key}>
                <Link
                  href={lancamentosHref(it.id)}
                  className="flex items-center justify-between gap-2 text-xs rounded px-1 -mx-1 hover:bg-muted/40"
                  title={`Ver lançamentos de ${it.name.replace(/^\(diretos em |\)$/g, "")} no mês`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      aria-hidden
                      className="text-muted-foreground/60 select-none"
                    >
                      ↳
                    </span>
                    <span
                      aria-hidden
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: subColor }}
                    />
                    <span
                      className={cn(
                        "truncate",
                        it.italic && "italic text-muted-foreground",
                      )}
                    >
                      {it.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums text-muted-foreground shrink-0">
                    <span>{subPct.toFixed(0)}%</span>
                    <span className="font-medium text-foreground">
                      {formatBRL(it.total.toFixed(2))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
