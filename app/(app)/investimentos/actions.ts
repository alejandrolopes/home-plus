"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { investment, investmentSnapshot } from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";

const investmentSchema = z.object({
  id: z.string().uuid().optional(),
  institution: z.string().min(1).max(80),
  issuer: z.string().max(80).optional().or(z.literal("")),
  productName: z.string().min(1).max(120),
  class: z.enum(["fixed_income", "variable_income"]),
  maturityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  scope: z.enum(["personal", "family"]),
});

export type SaveInvestmentState =
  | { error?: string; fieldErrors?: Partial<Record<string, string>>; success?: boolean }
  | null;

export async function saveInvestmentAction(
  _prev: SaveInvestmentState,
  formData: FormData,
): Promise<SaveInvestmentState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = investmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }
  const d = parsed.data;
  const values = {
    institution: d.institution,
    issuer: d.issuer || null,
    productName: d.productName,
    class: d.class,
    maturityDate: d.maturityDate || null,
    color: d.color || null,
    notes: d.notes || null,
    ownerId: d.scope === "personal" ? userId : null,
  };

  if (d.id) {
    const [existing] = await db
      .select({ id: investment.id })
      .from(investment)
      .where(
        and(eq(investment.id, d.id), eq(investment.organizationId, orgId)),
      )
      .limit(1);
    if (!existing) return { error: "Investimento não encontrado." };
    await db
      .update(investment)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(investment.id, d.id));
  } else {
    await db.insert(investment).values({ organizationId: orgId, ...values });
  }

  revalidatePath("/investimentos");
  revalidatePath("/dashboard");
  return { success: true };
}

const snapshotSchema = z.object({
  investmentId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  applied: z
    .string()
    .regex(/^-?\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  balance: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
  notes: z.string().max(200).optional().or(z.literal("")),
});

export async function saveSnapshotAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const parsed = snapshotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { investmentId, month, applied, balance, notes } = parsed.data;

  const [inv] = await db
    .select({ id: investment.id })
    .from(investment)
    .where(
      and(
        eq(investment.id, investmentId),
        eq(investment.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!inv) return { error: "Investimento não encontrado." };

  const appliedCents = Math.round(Number(applied) * 100);
  const balanceCents = Math.round(Number(balance) * 100);

  // Upsert manual (single Postgres has ON CONFLICT, mas com FK e check é
  // mais simples ler antes pra atualizar/inserir corretamente).
  const [existing] = await db
    .select({ id: investmentSnapshot.id })
    .from(investmentSnapshot)
    .where(
      and(
        eq(investmentSnapshot.investmentId, investmentId),
        eq(investmentSnapshot.month, month),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(investmentSnapshot)
      .set({
        appliedCents,
        balanceCents,
        notes: notes || null,
        updatedAt: new Date(),
      })
      .where(eq(investmentSnapshot.id, existing.id));
  } else {
    await db.insert(investmentSnapshot).values({
      investmentId,
      organizationId: orgId,
      month,
      appliedCents,
      balanceCents,
      notes: notes || null,
    });
  }

  revalidatePath("/investimentos");
  revalidatePath(`/investimentos/${investmentId}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteSnapshotFormAction(formData: FormData): Promise<void> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [snap] = await db
    .select({
      id: investmentSnapshot.id,
      investmentId: investmentSnapshot.investmentId,
    })
    .from(investmentSnapshot)
    .where(
      and(
        eq(investmentSnapshot.id, id),
        eq(investmentSnapshot.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!snap) return;
  await db.delete(investmentSnapshot).where(eq(investmentSnapshot.id, id));
  revalidatePath("/investimentos");
  revalidatePath(`/investimentos/${snap.investmentId}`);
  revalidatePath("/dashboard");
}

export async function archiveInvestmentFormAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  const archived = String(formData.get("archived") ?? "true") === "true";
  if (!id) return;
  await db
    .update(investment)
    .set({ archived, updatedAt: new Date() })
    .where(
      and(eq(investment.id, id), eq(investment.organizationId, orgId)),
    );
  revalidatePath("/investimentos");
  revalidatePath("/dashboard");
}

export async function deleteInvestmentFormAction(
  formData: FormData,
): Promise<void> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db
    .delete(investment)
    .where(
      and(eq(investment.id, id), eq(investment.organizationId, orgId)),
    );
  revalidatePath("/investimentos");
  revalidatePath("/dashboard");
}
