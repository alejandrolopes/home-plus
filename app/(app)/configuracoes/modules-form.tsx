"use client";

import { useOptimistic, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toggleModuleAction } from "./actions";

type ModuleItem = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

type Props = {
  modules: ModuleItem[];
  canEdit: boolean;
};

export function ModulesForm({ modules, canEdit }: Props) {
  const [optimistic, setOptimistic] = useOptimistic(
    modules,
    (state, next: { key: string; enabled: boolean }) =>
      state.map((m) => (m.key === next.key ? { ...m, enabled: next.enabled } : m)),
  );
  const [pending, startTransition] = useTransition();

  const onToggle = (key: string, enabled: boolean) => {
    startTransition(async () => {
      setOptimistic({ key, enabled });
      const fd = new FormData();
      fd.set("moduleKey", key);
      fd.set("enabled", enabled ? "true" : "false");
      await toggleModuleAction(fd);
    });
  };

  return (
    <div
      data-pending={pending ? "true" : undefined}
      className="space-y-3 data-[pending=true]:opacity-70 transition-opacity"
    >
      {optimistic.map((m) => (
        <div
          key={m.key}
          className="flex items-start justify-between gap-3 rounded-md border p-3"
        >
          <div className="flex-1 min-w-0">
            <label
              htmlFor={`mod-${m.key}`}
              className="text-sm font-medium block"
            >
              {m.label}
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {m.description}
            </p>
          </div>
          <Switch
            id={`mod-${m.key}`}
            checked={m.enabled}
            onCheckedChange={(v) => onToggle(m.key, v)}
            disabled={!canEdit}
          />
        </div>
      ))}
      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Apenas admins da família podem mudar módulos.
        </p>
      ) : null}
    </div>
  );
}
