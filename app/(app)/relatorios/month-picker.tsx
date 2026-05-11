"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function shiftMonth(month: string, delta: number): string {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set("month", next);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div
      data-pending={pending ? "true" : undefined}
      className="flex items-center gap-1 data-[pending=true]:opacity-60 transition-opacity"
    >
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => apply(shiftMonth(month, -1))}
        aria-label="Mês anterior"
      >
        <ChevronLeft />
      </Button>
      <Input
        type="month"
        value={month}
        onChange={(e) => {
          if (e.target.value) apply(e.target.value);
        }}
        className="h-7 w-[140px] text-xs"
      />
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => apply(shiftMonth(month, 1))}
        aria-label="Próximo mês"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
