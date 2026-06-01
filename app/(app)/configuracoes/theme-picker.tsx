"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Escuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
] as const;

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // next-themes hidrata no client; antes disso o valor inicial é incerto.
  useEffect(() => setMounted(true), []);

  const current = mounted ? theme ?? "system" : "system";

  return (
    <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-sm">
      {OPTIONS.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1 transition-colors",
              active
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={active}
          >
            <opt.Icon className="size-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
