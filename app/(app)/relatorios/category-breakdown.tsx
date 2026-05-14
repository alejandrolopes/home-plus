"use client";

import { useState } from "react";
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
}: {
  title: string;
  icon: React.ReactNode;
  groups: ReportGroup[];
  total: number;
  tone: "income" | "expense";
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
}: {
  group: ReportGroup;
  total: number;
  fallbackBar: string;
  valueClass: string;
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
    name: string;
    color: string | null;
    total: number;
    italic?: boolean;
  }> = [];
  if (group.directTotal > 0 && group.children.length > 0) {
    subItems.push({
      key: "__direct__",
      name: `(diretos em ${group.rootName})`,
      color: null,
      total: group.directTotal,
      italic: true,
    });
  }
  for (const c of group.children) {
    subItems.push({
      key: c.id,
      name: c.name,
      color: c.color,
      total: c.total,
    });
  }
  subItems.sort((a, b) => b.total - a.total);

  return (
    <li className="space-y-1">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 text-sm rounded-md py-0.5 px-1 -mx-1",
          expandable && "hover:bg-muted/40 cursor-pointer",
          !expandable && "cursor-default",
        )}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {expandable ? (
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform shrink-0",
                open && "rotate-90",
              )}
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
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
      </button>

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
              <li
                key={it.key}
                className="flex items-center justify-between gap-2 text-xs"
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
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
