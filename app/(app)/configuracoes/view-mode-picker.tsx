"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { setViewModeAction } from "@/lib/actions";
import type { ViewMode } from "@/lib/preferences";

export function ViewModePicker({ initial }: { initial: ViewMode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const set = (next: ViewMode) => {
    if (next === initial) return;
    startTransition(async () => {
      await setViewModeAction(next);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Option
        active={initial === "purchase"}
        disabled={pending}
        onClick={() => set("purchase")}
        icon={<CalendarDays className="size-4" />}
        title="Por compra"
        description="Compras no cartão contam no mês da compra. Pagamento da fatura não soma."
      />
      <Option
        active={initial === "invoice"}
        disabled={pending}
        onClick={() => set("invoice")}
        icon={<Receipt className="size-4" />}
        title="Por fatura"
        description="Compras agrupadas no fechamento. Pagamento da fatura é a despesa."
      />
    </div>
  );
}

function Option({
  active,
  disabled,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "hover:bg-muted/50",
        disabled && "opacity-60 pointer-events-none",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md",
            active ? "bg-primary text-primary-foreground" : "bg-muted",
          )}
        >
          {icon}
        </span>
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
