"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";

export async function acceptInvitationAction(
  invitationId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const result = await auth.api.acceptInvitation({
      body: { invitationId },
      headers: await headers(),
    });
    if (result?.invitation) {
      // Define a org aceita como ativa
      await auth.api.setActiveOrganization({
        body: { organizationId: result.invitation.organizationId },
        headers: await headers(),
      });
    }
    revalidatePath("/familia");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao aceitar convite." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}

export async function rejectInvitationAction(
  invitationId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await auth.api.rejectInvitation({
      body: { invitationId },
      headers: await headers(),
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao recusar convite." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}
