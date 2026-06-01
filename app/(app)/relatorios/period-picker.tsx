"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Period = "month" | "ytd" | "l12m";

function shiftMonth(month: string, delta: number): string {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function PeriodPicker({
  period,
  month,
}: {
  period: Period;
  month: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (next: Partial<{ period: Period; month: string }>) => {
    const params = new URLSearchParams(sp.toString());
    if (next.period !== undefined) {
      if (next.period === "month") params.delete("period");
      else params.set("period", next.period);
    }
    if (next.month !== undefined) params.set("month", next.month);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div
      data-pending={pending ? "true" : undefined}
      className="flex items-center gap-2 flex-wrap data-[pending=true]:opacity-60 transition-opacity"
    >
      <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-xs">
        {(
          [
            { value: "month", label: "Mês" },
            { value: "ytd", label: "Ano até hoje" },
            { value: "l12m", label: "Últimos 12 meses" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => apply({ period: opt.value })}
            className={cn(
              "rounded px-2.5 py-1 transition-colors",
              period === opt.value
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {period === "month" ? (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => apply({ month: shiftMonth(month, -1) })}
            aria-label="Mês anterior"
          >
            <ChevronLeft />
          </Button>
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) apply({ month: e.target.value });
            }}
            className="h-7 w-[140px] text-xs"
          />
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => apply({ month: shiftMonth(month, 1) })}
            aria-label="Próximo mês"
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
