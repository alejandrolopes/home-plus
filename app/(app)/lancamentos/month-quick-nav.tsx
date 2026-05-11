"use client";

import { useEffect, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthBounds(monthIso: string): { from: string; to: string } {
  const [yStr, mStr] = monthIso.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  return { from: ymd(first), to: ymd(last) };
}

function shiftMonth(monthIso: string, delta: number): string {
  const [yStr, mStr] = monthIso.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Detecta se o range from/to corresponde exatamente a um mês civil.
 * Retorna o mês ISO (yyyy-mm) ou null pra range custom.
 */
function detectMonth(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return null;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy !== ty || fm !== tm) return null;
  if (fd !== 1) return null;
  const lastDay = new Date(fy, fm, 0).getDate();
  if (td !== lastDay) return null;
  return `${fy}-${String(fm).padStart(2, "0")}`;
}

const monthLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});

function formatMonthLabel(monthIso: string): string {
  const [yStr, mStr] = monthIso.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1, 1);
  const label = monthLabelFormatter.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function MonthQuickNav({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const detected = detectMonth(from, to);
  const month = detected ?? currentMonthIso();
  const isCustomRange = !detected;
  const todayMonth = currentMonthIso();
  const isCurrentMonth = month === todayMonth && !isCustomRange;

  const applyMonth = (nextMonth: string) => {
    if (!nextMonth) return;
    const { from: f, to: t } = monthBounds(nextMonth);
    const params = new URLSearchParams(sp.toString());
    params.set("from", f);
    params.set("to", t);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          (target.tagName === "SELECT"))
      )
        return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        applyMonth(shiftMonth(month, -1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        applyMonth(shiftMonth(month, 1));
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        applyMonth(todayMonth);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [month, todayMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-pending={pending ? "true" : undefined}
      className="flex items-center gap-1.5 data-[pending=true]:opacity-60 transition-opacity"
      title="Atalhos: ← anterior · → próximo · T hoje"
    >
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => applyMonth(shiftMonth(month, -1))}
        aria-label="Mês anterior"
      >
        <ChevronLeft />
      </Button>
      <div className="relative">
        <div className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-medium tabular-nums hover:bg-muted/50 transition-colors">
          <CalendarDays className="size-3.5 text-muted-foreground" />
          <span>
            {isCustomRange ? "Personalizado" : formatMonthLabel(month)}
          </span>
        </div>
        <Input
          type="month"
          value={month}
          onChange={(e) => applyMonth(e.target.value)}
          aria-label="Selecionar mês"
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => applyMonth(shiftMonth(month, 1))}
        aria-label="Próximo mês"
      >
        <ChevronRight />
      </Button>
      {!isCurrentMonth ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => applyMonth(todayMonth)}
        >
          Hoje
        </Button>
      ) : null}
    </div>
  );
}
