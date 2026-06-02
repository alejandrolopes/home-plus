"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  financialAccount,
  investment,
  plan,
  planContribution,
} from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";
import { recomputePlanCurrent } from "@/lib/repos/plans";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const planSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Informe o nome").max(80),
  description: z.string().max(500).optional().or(z.literal("")),
  target: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  startDate: z.string().regex(ISO_DATE, "Data inválida"),
  endDate: z.string().regex(ISO_DATE, "Data inválida"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  scope: z.enum(["personal", "family"]),
  linkType: z.enum(["account", "investment"]),
  linkMode: z.enum(["existing", "new"]),
  linkedAccountId: z.string().uuid().optional().or(z.literal("")),
  linkedInvestmentId: z.string().uuid().optional().or(z.literal("")),
  // Campos para criação inline
  newAccountName: z.string().max(80).optional().or(z.literal("")),
  newInvestmentInstitution: z
    .string()
    .max(80)
    .optional()
    .or(z.literal("")),
  newInvestmentProductName: z
    .string()
    .max(120)
    .optional()
    .or(z.literal("")),
  newInvestmentClass: z
    .enum(["fixed_income", "variable_income"])
    .optional(),
});

export type SavePlanState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function savePlanAction(
  _prev: SavePlanState,
  formData: FormData,
): Promise<SavePlanState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = planSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const {
    id,
    name,
    description,
    target,
    startDate,
    endDate,
    color,
    scope,
    linkType,
    linkMode,
    linkedAccountId,
    linkedInvestmentId,
    newAccountName,
    newInvestmentInstitution,
    newInvestmentProductName,
    newInvestmentClass,
  } = parsed.data;

  if (endDate < startDate) {
    return { error: "Data de fim deve ser >= data de início." };
  }

  const targetCents = Math.round(Number(target) * 100);
  if (!Number.isFinite(targetCents) || targetCents <= 0) {
    return { error: "Valor alvo deve ser maior que zero." };
  }

  // Resolve a entidade vinculada: existente ou cria nova inline
  let resolvedAccountId: string | null = null;
  let resolvedInvestmentId: string | null = null;

  if (linkType === "account") {
    if (linkMode === "existing") {
      if (!linkedAccountId) return { error: "Selecione uma conta." };
      resolvedAccountId = linkedAccountId;
    } else {
      const accountName = (newAccountName ?? "").trim();
      if (!accountName)
        return { error: "Informe o nome da nova conta." };
      const ownerForAccount = scope === "personal" ? userId : userId;
      const [created] = await db
        .insert(financialAccount)
        .values({
          organizationId: orgId,
          ownerId: ownerForAccount,
          name: accountName,
          type: "checking",
          color: color || null,
          initialBalance: "0",
        })
        .returning({ id: financialAccount.id });
      resolvedAccountId = created.id;
    }
  } else if (linkType === "investment") {
    if (linkMode === "existing") {
      if (!linkedInvestmentId)
        return { error: "Selecione um investimento." };
      resolvedInvestmentId = linkedInvestmentId;
    } else {
      const institution = (newInvestmentInstitution ?? "").trim();
      const productName = (newInvestmentProductName ?? "").trim();
      const klass = newInvestmentClass;
      if (!institution || !productName || !klass) {
        return {
          error: "Informe instituição, produto e classe do investimento.",
        };
      }
      const ownerForInv = scope === "personal" ? userId : null;
      const [created] = await db
        .insert(investment)
        .values({
          organizationId: orgId,
          ownerId: ownerForInv,
          institution,
          productName,
          class: klass,
          color: color || null,
        })
        .returning({ id: investment.id });
      resolvedInvestmentId = created.id;
    }
  }

  const values = {
    name,
    description: description || null,
    targetCents,
    startDate,
    endDate,
    color: color || null,
    ownerId: scope === "personal" ? userId : null,
    linkedAccountId: resolvedAccountId,
    linkedInvestmentId: resolvedInvestmentId,
  };

  if (id) {
    // Verifica que pertence à org
    const [existing] = await db
      .select({ id: plan.id })
      .from(plan)
      .where(and(eq(plan.id, id), eq(plan.organizationId, orgId)))
      .limit(1);
    if (!existing) return { error: "Plano não encontrado." };
    await db
      .update(plan)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(plan.id, id));
  } else {
    await db.insert(plan).values({ organizationId: orgId, ...values });
  }

  revalidatePath("/planos");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Versão void das ações abaixo — pra usar como `action` direto em <form>
 * server component. Ignora o resultado (silencia erros de validação simples).
 */
export async function archivePlanFormAction(formData: FormData): Promise<void> {
  await archivePlanAction(formData);
}
export async function deletePlanFormAction(formData: FormData): Promise<void> {
  await deletePlanAction(formData);
}
export async function deleteContributionFormAction(
  formData: FormData,
): Promise<void> {
  await deleteContributionAction(formData);
}

export async function archivePlanAction(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID inválido." };
  const archived = String(formData.get("archived") ?? "true") === "true";

  const [existing] = await db
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.id, id), eq(plan.organizationId, orgId)))
    .limit(1);
  if (!existing) return { error: "Plano não encontrado." };

  await db
    .update(plan)
    .set({ archived, updatedAt: new Date() })
    .where(eq(plan.id, id));

  revalidatePath("/planos");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deletePlanAction(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID inválido." };

  const [existing] = await db
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.id, id), eq(plan.organizationId, orgId)))
    .limit(1);
  if (!existing) return { error: "Plano não encontrado." };

  await db.delete(plan).where(eq(plan.id, id));
  revalidatePath("/planos");
  revalidatePath("/dashboard");
  return { success: true };
}

const contributionSchema = z.object({
  planId: z.string().uuid(),
  amount: z
    .string()
    .regex(/^-?\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  occurredOn: z.string().regex(ISO_DATE, "Data inválida"),
  notes: z.string().max(200).optional().or(z.literal("")),
});

export async function addContributionAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = contributionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { planId, amount, occurredOn, notes } = parsed.data;

  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(cents) || cents === 0) {
    return { error: "Valor inválido (não pode ser zero)." };
  }

  const [p] = await db
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.id, planId), eq(plan.organizationId, orgId)))
    .limit(1);
  if (!p) return { error: "Plano não encontrado." };

  await db.insert(planContribution).values({
    planId,
    organizationId: orgId,
    contributorId: userId,
    amountCents: cents,
    occurredOn,
    notes: notes || null,
  });
  await recomputePlanCurrent(planId);

  revalidatePath("/planos");
  revalidatePath(`/planos/${planId}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteContributionAction(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID inválido." };

  const [c] = await db
    .select({ id: planContribution.id, planId: planContribution.planId })
    .from(planContribution)
    .where(
      and(
        eq(planContribution.id, id),
        eq(planContribution.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!c) return { error: "Aporte não encontrado." };

  await db.delete(planContribution).where(eq(planContribution.id, id));
  await recomputePlanCurrent(c.planId);

  revalidatePath("/planos");
  revalidatePath(`/planos/${c.planId}`);
  revalidatePath("/dashboard");
  return { success: true };
}
