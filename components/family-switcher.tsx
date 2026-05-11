"use client";

import { useState, useTransition } from "react";
import { Check, ChevronsUpDown, Home, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchFamilyAction } from "@/lib/actions";
import { CreateFamilyDialog } from "./create-family-dialog";

type Family = { id: string; name: string };

type Props = {
  families: Family[];
  activeId: string;
};

export function FamilySwitcher({ families, activeId }: Props) {
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const active = families.find((f) => f.id === activeId);

  const handleSelect = (orgId: string) => {
    if (orgId === activeId) return;
    startTransition(() => switchFamilyAction(orgId));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={pending}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors disabled:opacity-60"
            />
          }
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Home className="size-4" />
          </div>
          <div className="flex flex-1 flex-col leading-tight overflow-hidden">
            <span className="text-sm font-semibold">Home+</span>
            <span className="text-xs text-muted-foreground truncate">
              {active?.name ?? "Sem família"}
            </span>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Famílias</DropdownMenuLabel>
            {families.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onClick={() => handleSelect(f.id)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{f.name}</span>
                {f.id === activeId ? (
                  <Check className="size-4 text-muted-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Nova família
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateFamilyDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
