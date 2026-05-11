"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  creditCardInvoice,
  financialAccount,
  importPendingPayment,
  transaction,
} from "@/db/schema/finance";
import { requireOrganization } from "@/lib/guards";

export async function linkPendingPaymentAction(
  pendingId: string,
  target: { kind: "invoice"; id: string } | { kind: "transaction"; id: string },
): Promise<{ ok: true } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const [pending] = await db
    .select()
    .from(importPendingPayment)
    .where(
      and(
        eq(importPendingPayment.id, pendingId),
        eq(importPendingPayment.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!pending) return { error: "Pendência não encontrada." };
  if (pending.status !== "pending")
    return { error: "Pendência já foi resolvida." };

  if (target.kind === "invoice") {
    const [invoice] = await db
      .select()
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.id, target.id),
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.accountId, pending.accountId),
        ),
      )
      .limit(1);
    if (!invoice) return { error: "Fatura não encontrada." };
    if (invoice.status !== "paid")
      return { error: "A fatura precisa estar paga." };
    if (invoice.externalPaymentId)
      return { error: "Esta fatura já está vinculada a outro pagamento." };

    await db.transaction(async (tx) => {
      await tx
        .update(creditCardInvoice)
        .set({ externalPaymentId: pending.externalId })
        .where(eq(creditCardInvoice.id, target.id));

      await tx
        .update(importPendingPayment)
        .set({
          status: "linked",
          linkedInvoiceId: target.id,
          resolvedAt: new Date(),
        })
        .where(eq(importPendingPayment.id, pendingId));
    });
  } else {
    const [tx] = await db
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.id, target.id),
          eq(transaction.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!tx) return { error: "Transação não encontrada." };
    if (tx.externalPaymentId)
      return { error: "Esta transação já está vinculada a outro pagamento." };
    if (tx.amount !== pending.amount)
      return { error: "Valor da transação não bate com a pendência." };

    await db.transaction(async (db2) => {
      await db2
        .update(transaction)
        .set({ externalPaymentId: pending.externalId })
        .where(eq(transaction.id, target.id));

      await db2
        .update(importPendingPayment)
        .set({
          status: "linked",
          resolvedAt: new Date(),
        })
        .where(eq(importPendingPayment.id, pendingId));
    });
  }

  revalidatePath("/cartoes");
  revalidatePath("/lancamentos");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function retryAutoLinkPendingsAction(): Promise<{
  linked: number;
  ambiguous: number;
  unmatched: number;
}> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const pendings = await db
    .select()
    .from(importPendingPayment)
    .where(
      and(
        eq(importPendingPayment.organizationId, orgId),
        eq(importPendingPayment.status, "pending"),
      ),
    );

  let linked = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const pending of pendings) {
    // Self-heal: se já existe uma fatura ou transação com external_payment_id
    // = pending.external_id, o vínculo na verdade já foi feito; só precisamos
    // marcar a pendência como `linked`. Cobre casos onde o reimport recriou
    // a pendência mas o link na transação persistiu.
    const [existingInvLink] = await db
      .select({ id: creditCardInvoice.id })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.externalPaymentId, pending.externalId),
        ),
      )
      .limit(1);
    const [existingTxLink] = await db
      .select({ id: transaction.id })
      .from(transaction)
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.externalPaymentId, pending.externalId),
        ),
      )
      .limit(1);
    if (existingInvLink || existingTxLink) {
      await db
        .update(importPendingPayment)
        .set({
          status: "linked",
          linkedInvoiceId: existingInvLink?.id ?? null,
          resolvedAt: new Date(),
        })
        .where(eq(importPendingPayment.id, pending.id));
      linked++;
      continue;
    }

    const invoiceCandidates = await db
      .select({ id: creditCardInvoice.id })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.accountId, pending.accountId),
          eq(creditCardInvoice.status, "paid"),
          eq(creditCardInvoice.totalAmount, pending.amount),
          isNull(creditCardInvoice.externalPaymentId),
        ),
      );

    // Janela de ±10 dias em torno da data do pagamento pra evitar falsos
    // positivos com expenses de mesmo valor mas distantes.
    const pendingDate = new Date(`${pending.occurredOn}T00:00:00`);
    const fromIso = new Date(pendingDate);
    fromIso.setDate(pendingDate.getDate() - 10);
    const toIso = new Date(pendingDate);
    toIso.setDate(pendingDate.getDate() + 10);
    const fromDate = fromIso.toISOString().slice(0, 10);
    const toDate = toIso.toISOString().slice(0, 10);

    // Match permissivo: qualquer expense em conta NÃO-cartão com mesmo
    // amount, dentro da janela de datas, sem vínculo prévio. paymentMethod
    // pode ser qualquer (incluindo null).
    const txCandidates = await db
      .select({ id: transaction.id })
      .from(transaction)
      .innerJoin(
        financialAccount,
        eq(transaction.accountId, financialAccount.id),
      )
      .where(
        and(
          eq(transaction.organizationId, orgId),
          eq(transaction.kind, "expense"),
          eq(transaction.amount, pending.amount),
          isNull(transaction.externalPaymentId),
          isNull(transaction.creditCardInvoiceId),
          isNull(transaction.parentTransactionId),
          isNull(transaction.paidInvoiceId),
          sql`${financialAccount.type} != 'credit_card'`,
          sql`${transaction.occurredOn} BETWEEN ${fromDate} AND ${toDate}`,
        ),
      );

    // Faturas ABERTAS no mesmo cartão com totalAmount igual ao pagamento.
    // Se houver exatamente 1 + também 1 tx candidate, fechamos a fatura
    // vinculando o pagamento como `paid_invoice_id`.
    const openInvoiceCandidates = await db
      .select({ id: creditCardInvoice.id })
      .from(creditCardInvoice)
      .where(
        and(
          eq(creditCardInvoice.organizationId, orgId),
          eq(creditCardInvoice.accountId, pending.accountId),
          ne(creditCardInvoice.status, "paid"),
          eq(creditCardInvoice.totalAmount, pending.amount),
          isNull(creditCardInvoice.externalPaymentId),
        ),
      );

    const total = invoiceCandidates.length + txCandidates.length;
    if (total === 0) {
      unmatched++;
      continue;
    }
    if (total > 1) {
      ambiguous++;
      continue;
    }

    await db.transaction(async (tx) => {
      if (invoiceCandidates.length === 1) {
        await tx
          .update(creditCardInvoice)
          .set({ externalPaymentId: pending.externalId })
          .where(eq(creditCardInvoice.id, invoiceCandidates[0].id));
        await tx
          .update(importPendingPayment)
          .set({
            status: "linked",
            linkedInvoiceId: invoiceCandidates[0].id,
            resolvedAt: new Date(),
          })
          .where(eq(importPendingPayment.id, pending.id));
      } else if (
        txCandidates.length === 1 &&
        openInvoiceCandidates.length === 1
      ) {
        // Fecha a fatura aberta usando essa transação como pagamento.
        const txId = txCandidates[0].id;
        const invId = openInvoiceCandidates[0].id;
        const now = new Date();
        await tx
          .update(transaction)
          .set({
            externalPaymentId: pending.externalId,
            paymentMethod: "card_invoice_payment",
            paidInvoiceId: invId,
            updatedAt: now,
          })
          .where(eq(transaction.id, txId));
        await tx
          .update(creditCardInvoice)
          .set({
            status: "paid",
            paidAt: now,
            externalPaymentId: pending.externalId,
          })
          .where(eq(creditCardInvoice.id, invId));
        // Settla as transações da fatura
        await tx
          .update(transaction)
          .set({ settledAt: now })
          .where(
            and(
              eq(transaction.organizationId, orgId),
              eq(transaction.creditCardInvoiceId, invId),
            ),
          );
        await tx
          .update(importPendingPayment)
          .set({
            status: "linked",
            linkedInvoiceId: invId,
            resolvedAt: now,
          })
          .where(eq(importPendingPayment.id, pending.id));
      } else {
        // Apenas vincula a pendência à transação (não há fatura pra fechar)
        await tx
          .update(transaction)
          .set({
            externalPaymentId: pending.externalId,
            paymentMethod: "card_invoice_payment",
            updatedAt: new Date(),
          })
          .where(eq(transaction.id, txCandidates[0].id));
        await tx
          .update(importPendingPayment)
          .set({ status: "linked", resolvedAt: new Date() })
          .where(eq(importPendingPayment.id, pending.id));
      }
    });
    linked++;
  }

  revalidatePath("/cartoes");
  revalidatePath("/dashboard");
  return { linked, ambiguous, unmatched };
}

export async function dismissPendingPaymentAction(
  pendingId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const [pending] = await db
    .select()
    .from(importPendingPayment)
    .where(
      and(
        eq(importPendingPayment.id, pendingId),
        eq(importPendingPayment.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!pending) return { error: "Pendência não encontrada." };

  await db
    .update(importPendingPayment)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(eq(importPendingPayment.id, pendingId));

  revalidatePath("/cartoes");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function dismissAllPendingsAction(): Promise<{
  dismissed: number;
}> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;

  const result = await db
    .update(importPendingPayment)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(
      and(
        eq(importPendingPayment.organizationId, orgId),
        eq(importPendingPayment.status, "pending"),
      ),
    )
    .returning({ id: importPendingPayment.id });

  revalidatePath("/cartoes");
  revalidatePath("/dashboard");
  return { dismissed: result.length };
}
