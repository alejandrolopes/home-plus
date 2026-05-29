"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { value: "fixed" | "rolling" };

/** Toggle pra janela do histórico: 12 meses fixos (até hoje) vs janela móvel
 *  terminando no mês selecionado pelo MonthPicker. */
export function EssenciaisWindowToggle({ value }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (next: "fixed" | "rolling") => {
    const params = new URLSearchParams(sp.toString());
    if (next === "rolling") params.delete("window");
    else params.set("window", "fixed");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5 text-xs">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => set("rolling")}
        className={cn(
          "h-7 px-2 text-xs",
          value === "rolling" && "bg-background shadow-sm",
        )}
      >
        Até o mês selecionado
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => set("fixed")}
        className={cn(
          "h-7 px-2 text-xs",
          value === "fixed" && "bg-background shadow-sm",
        )}
      >
        Últimos 12 meses
      </Button>
    </div>
  );
}
