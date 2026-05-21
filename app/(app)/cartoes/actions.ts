"use server";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  category,
  creditCardInvoice,
  financialAccount,
  transaction,
} from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";

const paySchema = z.object({
  invoiceId: z.string().uuid(),
  sourceAccountId: z.string().uuid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  amount: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
});

export type PayInvoiceState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function payInvoiceAction(
  _prev: PayInvoiceState,
  formData: FormData,
): Promise<PayInvoiceState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = paySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const { invoiceId, sourceAccountId, paidOn, amount } = parsed.data;
  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select({
        id: creditCardInvoice.id,
        status: creditCardInvoice.status,
        accountId: creditCardInvoice.accountId,
        totalAmount: creditCardInvoice.totalAmount,
        periodEnd: creditCardInvoice.periodEnd,
      })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.id, invoiceId),
          eq(creditCardInvoice.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!invoice) {
      errorMsg = "Fatura não encontrada.";
      return;
    }
    if (invoice.status === "paid") {
      errorMsg = "Esta fatura já está paga.";
      return;
    }

    const [source] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, sourceAccountId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!source) {
      errorMsg = "Conta de origem não encontrada.";
      return;
    }
    if (source.type === "credit_card") {
      errorMsg = "Não é possível pagar fatura usando outro cartão de crédito.";
      return;
    }

    const [card] = await tx
      .select({ name: financialAccount.name })
      .from(financialAccount)
      .where(eq(financialAccount.id, invoice.accountId))
      .limit(1);

    const cardName = card?.name ?? "cartão";
    const monthLabel = invoice.periodEnd.slice(0, 7);

    await tx.insert(transaction).values({
      organizationId: orgId,
      accountId: source.id,
      kind: "expense",
      amount,
      description: `Pagamento fatura ${cardName} (${monthLabel})`,
      occurredOn: paidOn,
      purchaseDate: paidOn,
      paymentMethod: "card_invoice_payment",
      paidInvoiceId: invoice.id,
      createdById: userId,
      ownerId: source.ownerId,
    });

    const [discountRow] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${transaction.discountAmount}), 0)`,
      })
      .from(transaction)
      .where(
        and(
          eq(transaction.creditCardInvoiceId, invoice.id),
          eq(transaction.organizationId, orgId),
        ),
      );
    const discountSum = Number(discountRow?.total ?? 0);

    if (discountSum > 0) {
      await tx.insert(transaction).values({
        organizationId: orgId,
        accountId: source.id,
        kind: "income",
        amount: discountSum.toFixed(2),
        description: `Crédito desconto antecipação ${cardName} (${monthLabel})`,
        occurredOn: paidOn,
        purchaseDate: paidOn,
        createdById: userId,
        ownerId: source.ownerId,
      });
    }

    const now = new Date();
    await tx
      .update(creditCardInvoice)
      .set({ status: "paid", paidAt: now })
      .where(eq(creditCardInvoice.id, invoice.id));

    await tx
      .update(transaction)
      .set({ settledAt: now })
      .where(
        and(
          eq(transaction.creditCardInvoiceId, invoice.id),
          eq(transaction.organizationId, orgId),
        ),
      );
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function getInvoicePaymentCandidatesAction(
  invoiceId: string,
): Promise<
  | {
      candidates: Awaited<
        ReturnType<typeof import("@/lib/repos/invoices").listInvoicePaymentCandidates>
      >;
    }
  | { error: string }
> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [invoice] = await db
    .select({
      id: creditCardInvoice.id,
      totalAmount: creditCardInvoice.totalAmount,
      dueDate: creditCardInvoice.dueDate,
    })
    .from(creditCardInvoice)
    .where(
      and(
        eq(creditCardInvoice.id, invoiceId),
        eq(creditCardInvoice.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!invoice) return { error: "Fatura não encontrada." };

  const { listInvoicePaymentCandidates } = await import(
    "@/lib/repos/invoices"
  );
  const candidates = await listInvoicePaymentCandidates(orgId, {
    amount: invoice.totalAmount,
    dueDate: invoice.dueDate,
    ownerId: userId,
  });
  return { candidates };
}

const linkSchema = z.object({
  invoiceId: z.string().uuid(),
  transactionId: z.string().uuid(),
});

export async function linkInvoicePaymentAction(
  _prev: PayInvoiceState,
  formData: FormData,
): Promise<PayInvoiceState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Selecione um lançamento existente." };
  }
  const { invoiceId, transactionId } = parsed.data;
  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select({
        id: creditCardInvoice.id,
        status: creditCardInvoice.status,
        externalPaymentId: creditCardInvoice.externalPaymentId,
      })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.id, invoiceId),
          eq(creditCardInvoice.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!invoice) {
      errorMsg = "Fatura não encontrada.";
      return;
    }
    if (invoice.status === "paid") {
      errorMsg = "Esta fatura já está paga.";
      return;
    }

    const [target] = await tx
      .select({
        id: transaction.id,
        ownerId: transaction.ownerId,
        kind: transaction.kind,
        creditCardInvoiceId: transaction.creditCardInvoiceId,
        accountId: transaction.accountId,
      })
      .from(transaction)
      .where(
        and(
          eq(transaction.id, transactionId),
          eq(transaction.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!target) {
      errorMsg = "Lançamento não encontrado.";
      return;
    }
    if (target.kind !== "expense") {
      errorMsg = "Selecione uma despesa.";
      return;
    }
    if (target.creditCardInvoiceId) {
      errorMsg = "Esse lançamento já é uma compra de cartão, não um pagamento.";
      return;
    }
    if (target.ownerId !== userId) {
      // só admin pode linkar de conta de outro membro
      // simplificação: bloquear cross-owner por enquanto
      errorMsg = "Só é possível vincular um lançamento da sua conta.";
      return;
    }

    // Confere se essa transação já está vinculada a outra fatura
    const [alreadyLinked] = await tx
      .select({ id: creditCardInvoice.id })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.externalPaymentId, `linked:${transactionId}`),
        ),
      )
      .limit(1);
    if (alreadyLinked) {
      errorMsg = "Este lançamento já está vinculado a outra fatura.";
      return;
    }

    const now = new Date();
    await tx
      .update(transaction)
      .set({
        paymentMethod: "card_invoice_payment",
        paidInvoiceId: invoiceId,
        updatedAt: now,
      })
      .where(eq(transaction.id, transactionId));

    await tx
      .update(creditCardInvoice)
      .set({
        status: "paid",
        paidAt: now,
        externalPaymentId: `linked:${transactionId}`,
      })
      .where(eq(creditCardInvoice.id, invoiceId));

    await tx
      .update(transaction)
      .set({ settledAt: now })
      .where(
        and(
          eq(transaction.creditCardInvoiceId, invoiceId),
          eq(transaction.organizationId, orgId),
        ),
      );
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}

const consolidateSchema = z.object({
  cardId: z.string().uuid(),
  discount: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Desconto inválido")
    .transform((v) => v.replace(",", ".")),
});

export type ConsolidateState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function consolidateInstallmentsAction(
  _prev: ConsolidateState,
  formData: FormData,
): Promise<ConsolidateState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = consolidateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const transactionIds = formData.getAll("transactionIds").map(String);
  if (transactionIds.length === 0) {
    return { error: "Selecione ao menos uma parcela." };
  }

  const { cardId, discount } = parsed.data;
  const todayISO = new Date().toISOString().slice(0, 10);
  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, cardId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!card || card.type !== "credit_card") {
      errorMsg = "Cartão inválido.";
      return;
    }

    const [nextInvoice] = await tx
      .select()
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.accountId, card.id),
          sql`${creditCardInvoice.status} != 'paid'`,
        ),
      )
      .orderBy(creditCardInvoice.periodEnd)
      .limit(1);

    if (!nextInvoice) {
      errorMsg = "Não há fatura aberta neste cartão para receber a consolidação.";
      return;
    }

    const parcels = await tx
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.accountId, cardId),
          inArray(transaction.id, transactionIds),
        ),
      );

    if (parcels.length !== transactionIds.length) {
      errorMsg = "Uma ou mais parcelas não foram encontradas.";
      return;
    }
    for (const p of parcels) {
      if (p.settledAt) {
        errorMsg = "Uma das parcelas já está quitada.";
        return;
      }
      if (!p.creditCardInvoiceId) {
        errorMsg = "Parcela sem fatura associada.";
        return;
      }
      if (p.creditCardInvoiceId === nextInvoice.id) {
        errorMsg =
          "Selecione apenas parcelas de faturas POSTERIORES à próxima fatura aberta.";
        return;
      }
    }

    const nominalCents = parcels.reduce(
      (acc, p) => acc + Math.round(Number(p.amount) * 100),
      0,
    );
    const nominal = (nominalCents / 100).toFixed(2);
    const discountCents = Math.round(Number(discount) * 100);
    if (discountCents >= nominalCents) {
      errorMsg = "Desconto não pode ser igual ou maior que o valor nominal.";
      return;
    }

    const oldInvoiceMap = new Map<string, number>();
    for (const p of parcels) {
      const cents = Math.round(Number(p.amount) * 100);
      oldInvoiceMap.set(
        p.creditCardInvoiceId!,
        (oldInvoiceMap.get(p.creditCardInvoiceId!) ?? 0) + cents,
      );
    }

    for (const [invoiceId, decCents] of oldInvoiceMap) {
      const dec = (decCents / 100).toFixed(2);
      await tx
        .update(creditCardInvoice)
        .set({
          totalAmount: sql`${creditCardInvoice.totalAmount} - ${dec}`,
        })
        .where(eq(creditCardInvoice.id, invoiceId));
    }

    await tx.delete(transaction).where(inArray(transaction.id, transactionIds));

    const groups = new Set(
      parcels
        .map((p) => p.installmentGroupId)
        .filter((g): g is string => !!g),
    );
    const desc =
      groups.size === 1
        ? `Antecipação ${parcels.length} parcelas (${parcels[0].description.replace(/\s*\(\d+\/\d+\)\s*$/, "")})`
        : `Antecipação ${parcels.length} parcelas`;

    await tx.insert(transaction).values({
      organizationId: orgId,
      accountId: card.id,
      kind: "expense",
      amount: nominal,
      discountAmount: discountCents > 0 ? (discountCents / 100).toFixed(2) : null,
      description: desc,
      occurredOn: nextInvoice.periodEnd,
      purchaseDate: todayISO,
      creditCardInvoiceId: nextInvoice.id,
      notes:
        discountCents > 0
          ? `Consolidação de ${parcels.length} parcelas. Desconto de R$ ${(discountCents / 100).toFixed(2)} será creditado no pagamento da fatura.`
          : `Consolidação de ${parcels.length} parcelas.`,
      createdById: userId,
      ownerId: card.ownerId,
    });

    await tx
      .update(creditCardInvoice)
      .set({
        totalAmount: sql`${creditCardInvoice.totalAmount} + ${nominal}`,
      })
      .where(eq(creditCardInvoice.id, nextInvoice.id));
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}

const prepaySchema = z.object({
  cardId: z.string().uuid(),
  sourceAccountId: z.string().uuid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  amount: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, "Valor inválido")
    .transform((v) => v.replace(",", ".")),
});

export type PrepayCandidate = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  cleanDescription: string | null;
  accountId: string;
  accountName: string;
};

/**
 * Lista lançamentos candidatos a serem vinculados como antecipação:
 * despesas em contas não-cartão, sem vínculo prévio, dentro de janela
 * de 90 dias e amount entre 50%–110% do nominal.
 */
export async function getPrepayCandidatesAction(
  cardId: string,
  parcelIds: string[],
): Promise<{ candidates: PrepayCandidate[] } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  if (parcelIds.length === 0) return { error: "Selecione parcelas antes." };

  const parcels = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      ownerId: transaction.ownerId,
      occurredOn: transaction.occurredOn,
      purchaseDate: transaction.purchaseDate,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.accountId, cardId),
        inArray(transaction.id, parcelIds),
      ),
    );
  if (parcels.length === 0) return { error: "Parcelas não encontradas." };

  const nominalCents = parcels.reduce(
    (acc, p) => acc + Math.round(Number(p.amount) * 100),
    0,
  );
  const minCents = Math.floor(nominalCents * 0.5);
  const maxCents = Math.ceil(nominalCents * 1.1);

  // Janela: ±30 dias da data de compra mais antiga selecionada (ou occurredOn
  // se não houver purchaseDate). Antes a janela era "últimos 90 dias do hoje",
  // mas isso falhava para compras antigas — o débito antecipado pode ter sido
  // feito no mesmo dia da compra, então a janela tem que seguir a parcela.
  const parcelDates = parcels
    .map((p) => p.purchaseDate ?? p.occurredOn)
    .filter((d): d is string => !!d)
    .sort();
  const referenceIso = parcelDates[0] ?? new Date().toISOString().slice(0, 10);
  const ref = new Date(`${referenceIso}T00:00:00`);
  const from = new Date(ref);
  from.setDate(ref.getDate() - 30);
  const to = new Date(ref);
  to.setDate(ref.getDate() + 30);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      accountId: transaction.accountId,
      accountName: financialAccount.name,
    })
    .from(transaction)
    .innerJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.kind, "expense"),
        isNull(transaction.creditCardInvoiceId),
        isNull(transaction.paidInvoiceId),
        isNull(transaction.parentTransactionId),
        isNull(transaction.transferToAccountId),
        // externalPaymentId pode ser apenas o ID externo do banco (importação),
        // só descarta quando é prefixo reservado nosso (transfer:/linked:/prepay:).
        sql`(${transaction.externalPaymentId} IS NULL
          OR ${transaction.externalPaymentId} !~ '^(transfer|linked|prepay):')`,
        sql`${financialAccount.type} != 'credit_card'`,
        gte(transaction.occurredOn, fromIso),
        lte(transaction.occurredOn, toIso),
        sql`(${transaction.amount}::numeric * 100)::int BETWEEN ${minCents} AND ${maxCents}`,
      ),
    )
    .orderBy(desc(transaction.occurredOn));

  return {
    candidates: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      occurredOn: r.occurredOn,
      description: r.description,
      cleanDescription: r.cleanDescription,
      accountId: r.accountId ?? "",
      accountName: r.accountName,
    })),
  };
}

export type CardWithPendings = {
  id: string;
  name: string;
  color: string | null;
  purchases: Awaited<
    ReturnType<typeof import("@/lib/repos/invoices").listPendingPurchasesForCard>
  >;
};

/**
 * Lista cartões do user atual com suas compras pendentes (não quitadas).
 * Usado pelo dialog "Marcar como antecipação cartão" no /lancamentos.
 */
export async function getCardsWithPendingsAction(): Promise<{
  cards: CardWithPendings[];
}> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const { listPendingPurchasesForCard, getNextOpenInvoice } = await import(
    "@/lib/repos/invoices"
  );

  const cards = await db
    .select({
      id: financialAccount.id,
      name: financialAccount.name,
      color: financialAccount.color,
    })
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.organizationId, orgId),
        eq(financialAccount.ownerId, userId),
        eq(financialAccount.archived, false),
        eq(financialAccount.type, "credit_card"),
      ),
    );

  const out: CardWithPendings[] = [];
  for (const card of cards) {
    const next = await getNextOpenInvoice(orgId, card.id);
    const purchases = await listPendingPurchasesForCard(orgId, card.id, {
      afterPeriodEnd: next?.periodEnd,
    });
    if (purchases.length > 0) {
      out.push({
        id: card.id,
        name: card.name,
        color: card.color,
        purchases,
      });
    }
  }
  return { cards: out };
}

const linkPrepaySchema = z.object({
  cardId: z.string().uuid(),
  transactionId: z.string().uuid(),
});

export async function linkPrepayInstallmentsAction(
  _prev: PrepayState,
  formData: FormData,
): Promise<PrepayState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = linkPrepaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Selecione um lançamento existente." };

  const transactionIds = formData.getAll("transactionIds").map(String);
  if (transactionIds.length === 0) {
    return { error: "Selecione ao menos uma parcela." };
  }

  const { cardId, transactionId } = parsed.data;
  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, cardId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!card || card.type !== "credit_card") {
      errorMsg = "Cartão inválido.";
      return;
    }

    const [target] = await tx
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.id, transactionId),
          eq(transaction.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!target) {
      errorMsg = "Lançamento não encontrado.";
      return;
    }
    if (target.kind !== "expense") {
      errorMsg = "Selecione uma despesa.";
      return;
    }
    if (target.creditCardInvoiceId) {
      errorMsg = "Esse lançamento é uma compra do cartão, não um pagamento.";
      return;
    }
    if (target.ownerId !== userId) {
      errorMsg = "Só é possível vincular um lançamento da sua conta.";
      return;
    }

    const parcels = await tx
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.accountId, cardId),
          inArray(transaction.id, transactionIds),
        ),
      );
    if (parcels.length !== transactionIds.length) {
      errorMsg = "Uma ou mais parcelas não foram encontradas.";
      return;
    }
    for (const p of parcels) {
      if (p.settledAt) {
        errorMsg = "Uma das parcelas já está quitada.";
        return;
      }
      if (!p.creditCardInvoiceId) {
        errorMsg = "Parcela sem fatura associada.";
        return;
      }
    }

    const nominalCents = parcels.reduce(
      (acc, p) => acc + Math.round(Number(p.amount) * 100),
      0,
    );
    const paidCents = Math.round(Number(target.amount) * 100);
    const discountCents = Math.max(nominalCents - paidCents, 0);
    const nominal = (nominalCents / 100).toFixed(2);
    const discount = (discountCents / 100).toFixed(2);

    const descSuffix =
      discountCents > 0
        ? ` · antecipação ${parcels.length} parcela${parcels.length === 1 ? "" : "s"} ${card.name} (desconto ${discount} sobre ${nominal})`
        : ` · antecipação ${parcels.length} parcela${parcels.length === 1 ? "" : "s"} ${card.name}`;

    const newNotes = target.notes
      ? `${target.notes}${descSuffix}`
      : descSuffix.replace(/^ · /, "");

    const now = new Date();
    await tx
      .update(transaction)
      .set({
        paymentMethod: "card_prepay",
        notes: newNotes,
        updatedAt: now,
      })
      .where(eq(transaction.id, target.id));

    await tx
      .update(transaction)
      .set({ settledAt: now })
      .where(inArray(transaction.id, transactionIds));

    const invoiceMap = new Map<string, number>();
    for (const p of parcels) {
      const cents = Math.round(Number(p.amount) * 100);
      invoiceMap.set(
        p.creditCardInvoiceId!,
        (invoiceMap.get(p.creditCardInvoiceId!) ?? 0) + cents,
      );
    }
    for (const [invoiceId, decCents] of invoiceMap) {
      const dec = (decCents / 100).toFixed(2);
      await tx
        .update(creditCardInvoice)
        .set({
          totalAmount: sql`${creditCardInvoice.totalAmount} - ${dec}`,
        })
        .where(eq(creditCardInvoice.id, invoiceId));
    }
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}


export type PrepayState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  success?: boolean;
} | null;

export async function prepayInstallmentsAction(
  _prev: PrepayState,
  formData: FormData,
): Promise<PrepayState> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const parsed = prepaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "_")] = issue.message;
    }
    return { error: "Verifique os campos.", fieldErrors };
  }

  const transactionIds = formData.getAll("transactionIds").map(String);
  if (transactionIds.length === 0) {
    return { error: "Selecione ao menos uma parcela." };
  }

  const { cardId, sourceAccountId, paidOn, amount } = parsed.data;
  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, cardId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!card || card.type !== "credit_card") {
      errorMsg = "Cartão inválido.";
      return;
    }

    const [source] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, sourceAccountId),
          eq(financialAccount.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!source || source.type === "credit_card") {
      errorMsg = "Conta de origem inválida.";
      return;
    }

    const parcels = await tx
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.accountId, cardId),
          inArray(transaction.id, transactionIds),
        ),
      );

    if (parcels.length !== transactionIds.length) {
      errorMsg = "Uma ou mais parcelas não foram encontradas.";
      return;
    }
    for (const p of parcels) {
      if (p.settledAt) {
        errorMsg = "Uma das parcelas já está quitada.";
        return;
      }
      if (!p.creditCardInvoiceId) {
        errorMsg = "Parcela sem fatura associada.";
        return;
      }
    }

    const nominalCents = parcels.reduce(
      (acc, p) => acc + Math.round(Number(p.amount) * 100),
      0,
    );
    const paidCents = Math.round(Number(amount) * 100);
    const discountCents = nominalCents - paidCents;
    const nominal = (nominalCents / 100).toFixed(2);
    const discount = (discountCents / 100).toFixed(2);

    const descSuffix =
      discountCents > 0 ? ` (desconto ${discount} sobre ${nominal})` : "";

    await tx.insert(transaction).values({
      organizationId: orgId,
      accountId: source.id,
      kind: "expense",
      amount,
      description: `Antecipação ${parcels.length} parcela${parcels.length === 1 ? "" : "s"} ${card.name}${descSuffix}`,
      occurredOn: paidOn,
      purchaseDate: paidOn,
      paymentMethod: "card_prepay",
      notes:
        discountCents > 0
          ? `Quitou ${parcels.length} parcelas no valor nominal de R$ ${nominal} com R$ ${discount} de desconto.`
          : null,
      createdById: userId,
      ownerId: source.ownerId,
    });

    const now = new Date();
    await tx
      .update(transaction)
      .set({ settledAt: now })
      .where(inArray(transaction.id, transactionIds));

    const invoiceMap = new Map<string, number>();
    for (const p of parcels) {
      const cents = Math.round(Number(p.amount) * 100);
      invoiceMap.set(
        p.creditCardInvoiceId!,
        (invoiceMap.get(p.creditCardInvoiceId!) ?? 0) + cents,
      );
    }

    for (const [invoiceId, decCents] of invoiceMap) {
      const dec = (decCents / 100).toFixed(2);
      await tx
        .update(creditCardInvoice)
        .set({
          totalAmount: sql`${creditCardInvoice.totalAmount} - ${dec}`,
        })
        .where(eq(creditCardInvoice.id, invoiceId));
    }

    const invoiceIds = Array.from(invoiceMap.keys());
    if (invoiceIds.length > 0) {
      const remaining = await tx
        .select({
          invoiceId: transaction.creditCardInvoiceId,
          pending: sql<number>`COUNT(*)`,
        })
        .from(transaction)
        .where(
          and(
            inArray(transaction.creditCardInvoiceId, invoiceIds),
            sql`${transaction.settledAt} IS NULL`,
          ),
        )
        .groupBy(transaction.creditCardInvoiceId);

      const stillOpen = new Set(
        remaining
          .filter((r) => Number(r.pending) > 0)
          .map((r) => r.invoiceId!),
      );
      const fullyPaid = invoiceIds.filter((id) => !stillOpen.has(id));

      if (fullyPaid.length > 0) {
        await tx
          .update(creditCardInvoice)
          .set({ status: "paid", paidAt: now })
          .where(inArray(creditCardInvoice.id, fullyPaid));
      }
    }
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}


const applyPrepaySchema = z.object({
  transactionId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

const unlinkPrepaySchema = z.object({
  transactionId: z.string().uuid(),
});

export type InvoiceDetailTransaction = {
  id: string;
  occurredOn: string;
  purchaseDate: string | null;
  description: string;
  cleanDescription: string | null;
  amount: string;
  kind: "income" | "expense" | "transfer";
  installmentNumber: number | null;
  installmentTotal: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
};

export type InvoiceDetails = {
  id: string;
  accountId: string;
  cardName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalAmount: string;
  status: string;
  paidAt: Date | null;
  transactions: InvoiceDetailTransaction[];
};

/**
 * Retorna a fatura com nome do cartão e todos os lançamentos vinculados,
 * com categoria. Usado pelo dialog "Detalhes da fatura" para conferência.
 */
export async function getInvoiceDetailsAction(
  invoiceId: string,
): Promise<InvoiceDetails | null> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const [inv] = await db
    .select({
      id: creditCardInvoice.id,
      accountId: creditCardInvoice.accountId,
      cardName: financialAccount.name,
      periodStart: creditCardInvoice.periodStart,
      periodEnd: creditCardInvoice.periodEnd,
      dueDate: creditCardInvoice.dueDate,
      totalAmount: creditCardInvoice.totalAmount,
      status: creditCardInvoice.status,
      paidAt: creditCardInvoice.paidAt,
    })
    .from(creditCardInvoice)
    .innerJoin(
      financialAccount,
      eq(financialAccount.id, creditCardInvoice.accountId),
    )
    .where(
      and(
        eq(creditCardInvoice.id, invoiceId),
        eq(creditCardInvoice.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!inv) return null;

  const txRows = await db
    .select({
      id: transaction.id,
      occurredOn: transaction.occurredOn,
      purchaseDate: transaction.purchaseDate,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      amount: transaction.amount,
      kind: transaction.kind,
      installmentNumber: transaction.installmentNumber,
      installmentTotal: transaction.installmentTotal,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
    })
    .from(transaction)
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.creditCardInvoiceId, invoiceId),
      ),
    )
    .orderBy(
      asc(transaction.purchaseDate),
      asc(transaction.occurredOn),
      asc(transaction.createdAt),
    );

  return {
    id: inv.id,
    accountId: inv.accountId,
    cardName: inv.cardName,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    dueDate: inv.dueDate,
    totalAmount: inv.totalAmount,
    status: inv.status,
    paidAt: inv.paidAt,
    transactions: txRows.map((r) => ({
      id: r.id,
      occurredOn: r.occurredOn,
      purchaseDate: r.purchaseDate,
      description: r.description,
      cleanDescription: r.cleanDescription,
      amount: r.amount,
      kind: r.kind,
      installmentNumber: r.installmentNumber,
      installmentTotal: r.installmentTotal,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
    })),
  };
}

const updateInvoiceDatesSchema = z.object({
  invoiceId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
});

/**
 * Atualiza os metadados de data da fatura (período e vencimento) sem
 * realocar transações. Reagrupar transações em outras faturas é fluxo
 * separado (re-importar com flag de reimport).
 */
export async function updateInvoiceDatesAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const parsed = updateInvoiceDatesSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return { error: "Dados inválidos." };

  const { invoiceId, periodStart, periodEnd, dueDate } = parsed.data;
  if (periodStart > periodEnd) {
    return { error: "Início do período não pode ser depois do fim." };
  }

  const [existing] = await db
    .select({ id: creditCardInvoice.id })
    .from(creditCardInvoice)
    .where(
      and(
        eq(creditCardInvoice.id, invoiceId),
        eq(creditCardInvoice.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!existing) return { error: "Fatura não encontrada." };

  await db
    .update(creditCardInvoice)
    .set({ periodStart, periodEnd, dueDate })
    .where(eq(creditCardInvoice.id, invoiceId));

  revalidatePath("/cartoes");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Desfaz um vínculo de antecipação previamente aplicado: limpa paidInvoiceId
 * na transação e devolve o valor abatido ao totalAmount da fatura. Se a
 * fatura estava com status "paid" por causa desse abate, volta para "open".
 */
export async function unlinkPrepaymentAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const parsed = unlinkPrepaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };
  const { transactionId } = parsed.data;

  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.id, transactionId),
          eq(transaction.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!target) {
      errorMsg = "Transação não encontrada.";
      return;
    }
    if (!target.paidInvoiceId) {
      errorMsg = "Esta transação não está vinculada a nenhuma fatura.";
      return;
    }

    const [invoice] = await tx
      .select()
      .from(creditCardInvoice)
      .where(eq(creditCardInvoice.id, target.paidInvoiceId))
      .limit(1);
    if (!invoice) {
      errorMsg = "Fatura vinculada não encontrada.";
      return;
    }

    const targetCents = Math.round(Number(target.amount) * 100);
    const invoiceCents = Math.round(Number(invoice.totalAmount) * 100);
    const restoredCents = invoiceCents + targetCents;
    const restored = (restoredCents / 100).toFixed(2);

    await tx
      .update(transaction)
      .set({
        paidInvoiceId: null,
        updatedAt: new Date(),
      })
      .where(eq(transaction.id, transactionId));

    // Se estava marcada como paga só por causa desse abate, devolve pra
    // "open" e restaura totalAmount.
    const setPayload: {
      totalAmount: string;
      status?: "open" | "closed" | "paid";
      paidAt?: Date | null;
    } = { totalAmount: restored };
    if (invoice.status === "paid") {
      setPayload.status = "open";
      setPayload.paidAt = null;
    }
    await tx
      .update(creditCardInvoice)
      .set(setPayload)
      .where(eq(creditCardInvoice.id, invoice.id));
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Aplica retroativamente uma transação de antecipação (já vinculada via OFX
 * mas sem paidInvoiceId) a uma fatura aberta: seta paidInvoiceId na transação
 * e reduz totalAmount da fatura. Só fecha a fatura quando o abate zera o
 * saldo restante. Antecipação é abate parcial por design.
 */
export async function applyPrepaymentToInvoiceAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const parsed = applyPrepaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Dados inválidos." };

  const { transactionId, invoiceId } = parsed.data;

  let errorMsg: string | null = null;

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.id, transactionId),
          eq(transaction.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!target) {
      errorMsg = "Transação não encontrada.";
      return;
    }
    if (target.paidInvoiceId) {
      errorMsg = "Transação já está vinculada a uma fatura.";
      return;
    }

    const [invoice] = await tx
      .select()
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.id, invoiceId),
          eq(creditCardInvoice.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!invoice) {
      errorMsg = "Fatura não encontrada.";
      return;
    }
    if (invoice.status === "paid") {
      errorMsg = "Fatura já está fechada como paga.";
      return;
    }

    const targetCents = Math.round(Number(target.amount) * 100);
    const invoiceCents = Math.round(Number(invoice.totalAmount) * 100);
    const newCents = invoiceCents - targetCents;
    const newTotal = (newCents / 100).toFixed(2);

    const now = new Date();
    await tx
      .update(transaction)
      .set({
        paidInvoiceId: invoiceId,
        paymentMethod: "card_prepay",
        updatedAt: now,
      })
      .where(eq(transaction.id, transactionId));

    await tx
      .update(creditCardInvoice)
      .set({ totalAmount: newTotal })
      .where(eq(creditCardInvoice.id, invoiceId));

    if (newCents <= 0) {
      await tx
        .update(creditCardInvoice)
        .set({ status: "paid", paidAt: now, totalAmount: "0.00" })
        .where(eq(creditCardInvoice.id, invoiceId));
    }
  });

  if (errorMsg) return { error: errorMsg };

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { success: true };
}
