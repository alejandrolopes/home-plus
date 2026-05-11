"use client";

import { useState, useTransition } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeMemberAction, updateMemberRoleAction } from "./actions";

export function MemberActions({
  memberId,
  role,
  isSelf,
}: {
  memberId: string;
  userId: string;
  role: string;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isOwner = role === "owner";
  const isAdmin = role === "admin";

  const setRole = (next: "admin" | "member") => {
    setError(null);
    const fd = new FormData();
    fd.append("memberId", memberId);
    fd.append("role", next);
    startTransition(async () => {
      const r = await updateMemberRoleAction(fd);
      if ("error" in r) setError(r.error);
    });
  };

  const remove = () => {
    if (!confirm("Remover este membro da família?")) return;
    setError(null);
    const fd = new FormData();
    fd.append("memberId", memberId);
    startTransition(async () => {
      const r = await removeMemberAction(fd);
      if ("error" in r) setError(r.error);
    });
  };

  if (isOwner || isSelf) {
    return error ? (
      <p className="w-full text-xs text-destructive">{error}</p>
    ) : null;
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={pending}>
              <MoreVertical />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {isAdmin ? (
            <DropdownMenuItem onClick={() => setRole("member")}>
              Rebaixar para Membro
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setRole("admin")}>
              Promover a Admin
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={remove}
            className="text-destructive focus:text-destructive"
          >
            Remover da família
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
