"use server";

import { and, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { auth } from "@/lib/auth";
import { getMemberRole, isAdmin } from "@/lib/auth-permissions";
import { getSession, requireOrganization } from "@/lib/guards";
import {
  upsertFinanceSettings,
  upsertUserFinanceSettings,
} from "@/lib/repos/finance-settings";

export type ProfileState = {
  error?: string;
  success?: boolean;
} | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!name) return { error: "Informe o nome." };
  if (name.length > 80) return { error: "Nome muito longo (máx. 80)." };
  if (!email) return { error: "Informe o email." };
  if (!EMAIL_RE.test(email)) return { error: "Email inválido." };

  const session = await getSession();
  if (!session) return { error: "Sessão expirada." };

  try {
    const updates: Partial<{ name: string; email: string; emailVerified: boolean; updatedAt: Date }> = {};
    if (name !== session.user.name) updates.name = name;

    if (email !== session.user.email.toLowerCase()) {
      // Garante que o novo email não está em uso por outro user
      const [conflict] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.email, email), ne(user.id, session.user.id)))
        .limit(1);
      if (conflict) {
        return { error: "Este email já está em uso por outro usuário." };
      }
      updates.email = email;
      updates.emailVerified = false;
    }

    if (Object.keys(updates).length === 0) {
      return { success: true };
    }

    updates.updatedAt = new Date();
    await db.update(user).set(updates).where(eq(user.id, session.user.id));

    revalidatePath("/configuracoes");
    revalidatePath("/familia");
    revalidatePath("/familia/membros");
    return { success: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao atualizar perfil." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}

export type FamilyNameState = {
  error?: string;
  success?: boolean;
} | null;

export async function updateFamilyNameAction(
  _prev: FamilyNameState,
  formData: FormData,
): Promise<FamilyNameState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Informe o nome da família." };
  if (name.length > 80) return { error: "Nome muito longo (máx. 80)." };

  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const role = await getMemberRole(orgId, session.user.id);
  if (!isAdmin(role)) {
    return { error: "Apenas admins podem renomear a família." };
  }

  try {
    await auth.api.updateOrganization({
      body: { organizationId: orgId, data: { name } },
      headers: await headers(),
    });
    revalidatePath("/configuracoes");
    revalidatePath("/familia");
    return { success: true };
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao atualizar." };
    }
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado." };
  }
}

export type FidelidadeState = {
  error?: string;
  success?: boolean;
} | null;

function parsePct(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

export async function updateFidelidadeAction(
  _prev: FidelidadeState,
  formData: FormData,
): Promise<FidelidadeState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);
  const admin = isAdmin(role);

  const pactPctRaw = String(formData.get("pactOfferingPct") ?? "0").trim();
  const pactPct = parsePct(pactPctRaw);
  if (pactPct === null) return { error: "% de pacto inválida (0–100)." };

  try {
    // Dízimo é fixo em 10%, não vem do form. Só pacto é por usuário.
    // Admins também alternam o flag tithing_enabled da organização.
    await upsertUserFinanceSettings(orgId, userId, {
      pactOfferingPct: pactPct.toFixed(2),
    });
    if (admin) {
      const enabled = formData.get("enabled") === "on";
      await upsertFinanceSettings(orgId, { tithingEnabled: enabled });
    }
    revalidatePath("/configuracoes");
    revalidatePath("/dashboard");
    revalidatePath("/lancamentos");
    return { success: true };
  } catch (e) {
    if (e instanceof Error) return { error: e.message };
    return { error: "Erro inesperado ao salvar." };
  }
}
