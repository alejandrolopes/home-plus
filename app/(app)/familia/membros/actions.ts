"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { requireOrganization } from "@/lib/guards";
import { getMemberRole, isAdmin } from "@/lib/auth-permissions";
import { listFamilyMembers } from "@/lib/repos/members";

export type InviteState = {
  error?: string;
  invitationId?: string;
  inviteLink?: string;
} | null;

async function requireAdmin() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const role = await getMemberRole(orgId, session.user.id);
  if (!isAdmin(role)) {
    throw new Error("Apenas admins podem gerenciar membros.");
  }
  return { session, orgId };
}

function buildInviteLink(invitationId: string): string {
  const base =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!base) return `/accept-invitation/${invitationId}`;
  return `${base.replace(/\/$/, "")}/accept-invitation/${invitationId}`;
}

export async function inviteMemberAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");

  if (!email) return { error: "Informe o email." };
  if (role !== "admin" && role !== "member") {
    return { error: "Role inválida." };
  }

  try {
    await requireAdmin();
    const invitation = await auth.api.createInvitation({
      body: { email, role },
      headers: await headers(),
    });
    revalidatePath("/familia/membros");
    revalidatePath("/familia");
    return {
      invitationId: invitation?.id,
      inviteLink: invitation?.id ? buildInviteLink(invitation.id) : undefined,
    };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao convidar." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}

export async function cancelInvitationAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return { error: "ID inválido." };

  try {
    await requireAdmin();
    await auth.api.cancelInvitation({
      body: { invitationId },
      headers: await headers(),
    });
    revalidatePath("/familia/membros");
    return { ok: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao cancelar convite." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}

export async function updateMemberRoleAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!memberId) return { error: "Membro inválido." };
  if (role !== "admin" && role !== "member") {
    return { error: "Role inválida." };
  }

  try {
    const { orgId } = await requireAdmin();
    // Garante que ainda existe pelo menos 1 admin/owner ao rebaixar
    if (role === "member") {
      const members = await listFamilyMembers(orgId);
      const admins = members.filter(
        (m) => m.role === "owner" || m.role === "admin",
      );
      const target = members.find((m) => m.memberId === memberId);
      if (
        target &&
        (target.role === "owner" || target.role === "admin") &&
        admins.length <= 1
      ) {
        return {
          error: "A família precisa de pelo menos 1 admin. Promova outro antes.",
        };
      }
    }

    await auth.api.updateMemberRole({
      body: { memberId, role: role as "admin" | "member" },
      headers: await headers(),
    });
    revalidatePath("/familia/membros");
    revalidatePath("/familia");
    return { ok: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao alterar papel." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}

export async function removeMemberAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) return { error: "Membro inválido." };

  try {
    const { orgId } = await requireAdmin();
    const members = await listFamilyMembers(orgId);
    const target = members.find((m) => m.memberId === memberId);
    if (!target) return { error: "Membro não encontrado." };

    if (target.role === "owner") {
      return { error: "O dono da família não pode ser removido." };
    }

    const admins = members.filter(
      (m) => m.role === "owner" || m.role === "admin",
    );
    if (target.role === "admin" && admins.length <= 1) {
      return {
        error: "A família precisa de pelo menos 1 admin.",
      };
    }

    await auth.api.removeMember({
      body: { memberIdOrEmail: memberId },
      headers: await headers(),
    });
    revalidatePath("/familia/membros");
    revalidatePath("/familia");
    return { ok: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao remover membro." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}
