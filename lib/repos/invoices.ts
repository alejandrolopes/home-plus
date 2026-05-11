import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  creditCardInvoice,
  financialAccount,
  importPendingPayment,
  transaction,
} from "@/db/schema/finance";

export type InvoiceWithAccount = typeof creditCardInvoice.$inferSelect & {
  account: { id: string; name: string; color: string | null; dueDay: number | null; closingDay: number | null; creditLimit: string | null };
};

export async function listInvoicesByCard(
  orgId: string,
  options: { ownerId?: string } = {},
) {
  const where = [eq(creditCardInvoice.organizationId, orgId)];
  if (options.ownerId) {
    where.push(eq(financialAccount.ownerId, options.ownerId));
  }
  const rows = await db
    .select({
      id: creditCardInvoice.id,
      organizationId: creditCardInvoice.organizationId,
      accountId: creditCardInvoice.accountId,
      periodStart: creditCardInvoice.periodStart,
      periodEnd: creditCardInvoice.periodEnd,
      dueDate: creditCardInvoice.dueDate,
      totalAmount: creditCardInvoice.totalAmount,
      status: creditCardInvoice.status,
      paidAt: creditCardInvoice.paidAt,
      createdAt: creditCardInvoice.createdAt,
      account_id: financialAccount.id,
      account_name: financialAccount.name,
      account_color: financialAccount.color,
      account_dueDay: financialAccount.dueDay,
      account_closingDay: financialAccount.closingDay,
      account_creditLimit: financialAccount.creditLimit,
    })
    .from(creditCardInvoice)
    .innerJoin(
      financialAccount,
      eq(creditCardInvoice.accountId, financialAccount.id),
    )
    .where(and(...where))
    .orderBy(asc(financialAccount.name), desc(creditCardInvoice.periodEnd));

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    accountId: r.accountId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    dueDate: r.dueDate,
    totalAmount: r.totalAmount,
    status: r.status,
    paidAt: r.paidAt,
    createdAt: r.createdAt,
    account: {
      id: r.account_id,
      name: r.account_name,
      color: r.account_color,
      dueDay: r.account_dueDay,
      closingDay: r.account_closingDay,
      creditLimit: r.account_creditLimit,
    },
  }));
}

export async function listInvoiceTransactions(orgId: string, invoiceId: string) {
  return db
    .select()
    .from(transaction)
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.creditCardInvoiceId, invoiceId),
      ),
    )
    .orderBy(asc(transaction.occurredOn), asc(transaction.createdAt));
}

export type PendingInstallment = {
  id: string;
  description: string;
  amount: string;
  installmentNumber: number;
  installmentTotal: number;
  invoiceId: string;
  invoicePeriodEnd: string;
  invoiceDueDate: string;
};

export async function listPendingInstallmentsForCard(
  orgId: string,
  cardId: string,
): Promise<PendingInstallment[]> {
  const rows = await db
    .select({
      id: transaction.id,
      description: transaction.description,
      amount: transaction.amount,
      installmentNumber: transaction.installmentNumber,
      installmentTotal: transaction.installmentTotal,
      invoiceId: creditCardInvoice.id,
      invoicePeriodEnd: creditCardInvoice.periodEnd,
      invoiceDueDate: creditCardInvoice.dueDate,
      invoiceStatus: creditCardInvoice.status,
    })
    .from(transaction)
    .innerJoin(
      creditCardInvoice,
      eq(transaction.creditCardInvoiceId, creditCardInvoice.id),
    )
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.accountId, cardId),
        sql`${transaction.installmentNumber} IS NOT NULL`,
        sql`${transaction.settledAt} IS NULL`,
        sql`${creditCardInvoice.status} != 'paid'`,
      ),
    )
    .orderBy(asc(creditCardInvoice.periodEnd));

  return rows
    .filter((r) => r.installmentNumber != null && r.installmentTotal != null)
    .map((r) => ({
      id: r.id,
      description: r.description,
      amount: r.amount,
      installmentNumber: r.installmentNumber!,
      installmentTotal: r.installmentTotal!,
      invoiceId: r.invoiceId,
      invoicePeriodEnd: r.invoicePeriodEnd,
      invoiceDueDate: r.invoiceDueDate,
    }));
}

export type PendingPurchaseGroup = {
  key: string;
  description: string;
  pendingAmount: string;
  pendingCount: number;
  installmentTotal: number | null;
  parcelIds: string[];
  earliestInvoicePeriodEnd: string;
  purchaseDate: string;
  futurePendingAmount: string;
  futurePendingCount: number;
  futureParcelIds: string[];
};

export async function listPendingPurchasesForCard(
  orgId: string,
  cardId: string,
  options: { afterPeriodEnd?: string } = {},
): Promise<PendingPurchaseGroup[]> {
  const rows = await db
    .select({
      id: transaction.id,
      description: transaction.description,
      amount: transaction.amount,
      installmentNumber: transaction.installmentNumber,
      installmentTotal: transaction.installmentTotal,
      installmentGroupId: transaction.installmentGroupId,
      occurredOn: transaction.occurredOn,
      purchaseDate: transaction.purchaseDate,
      invoiceId: creditCardInvoice.id,
      invoicePeriodEnd: creditCardInvoice.periodEnd,
    })
    .from(transaction)
    .innerJoin(
      creditCardInvoice,
      eq(transaction.creditCardInvoiceId, creditCardInvoice.id),
    )
    .where(
      and(
        eq(transaction.organizationId, orgId),
        eq(transaction.accountId, cardId),
        sql`${transaction.settledAt} IS NULL`,
        sql`${creditCardInvoice.status} != 'paid'`,
      ),
    )
    .orderBy(asc(creditCardInvoice.periodEnd));

  type Group = {
    key: string;
    description: string;
    pendingCents: number;
    pendingCount: number;
    installmentTotal: number | null;
    parcelIds: string[];
    earliestInvoicePeriodEnd: string;
    purchaseDate: string;
    futurePendingCents: number;
    futurePendingCount: number;
    futureParcelIds: string[];
  };

  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = r.installmentGroupId ?? r.id;
    const cents = Math.round(Number(r.amount) * 100);
    const isFuture = options.afterPeriodEnd
      ? r.invoicePeriodEnd > options.afterPeriodEnd
      : false;
    const baseDesc = r.description.replace(/\s*\(\d+\/\d+\)\s*$/, "");
    const txDate = r.purchaseDate ?? r.occurredOn;

    const existing = map.get(key);
    if (existing) {
      existing.pendingCents += cents;
      existing.pendingCount += 1;
      existing.parcelIds.push(r.id);
      if (r.invoicePeriodEnd < existing.earliestInvoicePeriodEnd) {
        existing.earliestInvoicePeriodEnd = r.invoicePeriodEnd;
      }
      if (txDate < existing.purchaseDate) {
        existing.purchaseDate = txDate;
      }
      if (isFuture) {
        existing.futurePendingCents += cents;
        existing.futurePendingCount += 1;
        existing.futureParcelIds.push(r.id);
      }
    } else {
      map.set(key, {
        key,
        description: baseDesc,
        pendingCents: cents,
        pendingCount: 1,
        installmentTotal: r.installmentTotal,
        parcelIds: [r.id],
        earliestInvoicePeriodEnd: r.invoicePeriodEnd,
        purchaseDate: txDate,
        futurePendingCents: isFuture ? cents : 0,
        futurePendingCount: isFuture ? 1 : 0,
        futureParcelIds: isFuture ? [r.id] : [],
      });
    }
  }

  return Array.from(map.values()).map((g) => ({
    key: g.key,
    description: g.description,
    pendingAmount: (g.pendingCents / 100).toFixed(2),
    pendingCount: g.pendingCount,
    installmentTotal: g.installmentTotal,
    parcelIds: g.parcelIds,
    earliestInvoicePeriodEnd: g.earliestInvoicePeriodEnd,
    purchaseDate: g.purchaseDate,
    futurePendingAmount: (g.futurePendingCents / 100).toFixed(2),
    futurePendingCount: g.futurePendingCount,
    futureParcelIds: g.futureParcelIds,
  }));
}

export type PendingPayment = {
  id: string;
  accountId: string;
  accountName: string;
  accountColor: string | null;
  externalId: string;
  amount: string;
  occurredOn: string;
  rawDescription: string;
  source: string;
  createdAt: Date;
};

export async function listPendingPayments(
  orgId: string,
  options: { ownerId?: string } = {},
): Promise<PendingPayment[]> {
  const where = [
    eq(importPendingPayment.organizationId, orgId),
    eq(importPendingPayment.status, "pending"),
  ];
  if (options.ownerId) {
    where.push(eq(financialAccount.ownerId, options.ownerId));
  }
  const rows = await db
    .select({
      id: importPendingPayment.id,
      accountId: importPendingPayment.accountId,
      externalId: importPendingPayment.externalId,
      amount: importPendingPayment.amount,
      occurredOn: importPendingPayment.occurredOn,
      rawDescription: importPendingPayment.rawDescription,
      source: importPendingPayment.source,
      createdAt: importPendingPayment.createdAt,
      accountName: financialAccount.name,
      accountColor: financialAccount.color,
    })
    .from(importPendingPayment)
    .innerJoin(
      financialAccount,
      eq(importPendingPayment.accountId, financialAccount.id),
    )
    .where(and(...where))
    .orderBy(desc(importPendingPayment.occurredOn));

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: r.accountName,
    accountColor: r.accountColor,
    externalId: r.externalId,
    amount: r.amount,
    occurredOn: r.occurredOn,
    rawDescription: r.rawDescription,
    source: r.source,
    createdAt: r.createdAt,
  }));
}

export type LinkableInvoice = {
  id: string;
  periodEnd: string;
  dueDate: string;
  totalAmount: string;
  paidAt: Date | null;
};

export async function listLinkableInvoicesForCard(
  orgId: string,
  cardId: string,
): Promise<LinkableInvoice[]> {
  const rows = await db
    .select({
      id: creditCardInvoice.id,
      periodEnd: creditCardInvoice.periodEnd,
      dueDate: creditCardInvoice.dueDate,
      totalAmount: creditCardInvoice.totalAmount,
      paidAt: creditCardInvoice.paidAt,
    })
    .from(creditCardInvoice)
    .where(
      and(
        eq(creditCardInvoice.organizationId, orgId),
        eq(creditCardInvoice.accountId, cardId),
        eq(creditCardInvoice.status, "paid"),
        isNull(creditCardInvoice.externalPaymentId),
      ),
    )
    .orderBy(desc(creditCardInvoice.periodEnd));

  return rows;
}

export type LinkablePaymentTx = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  paymentMethod: string;
  accountName: string;
};

export async function listLinkablePaymentTransactions(
  orgId: string,
  amount: string,
  options: { occurredOn?: string; windowDays?: number } = {},
): Promise<LinkablePaymentTx[]> {
  const where = [
    eq(transaction.organizationId, orgId),
    eq(transaction.kind, "expense"),
    eq(transaction.amount, amount),
    isNull(transaction.externalPaymentId),
    isNull(transaction.creditCardInvoiceId),
    isNull(transaction.parentTransactionId),
    isNull(transaction.paidInvoiceId),
    sql`${financialAccount.type} != 'credit_card'`,
  ];
  if (options.occurredOn) {
    const days = options.windowDays ?? 10;
    const d = new Date(`${options.occurredOn}T00:00:00`);
    const from = new Date(d);
    from.setDate(d.getDate() - days);
    const to = new Date(d);
    to.setDate(d.getDate() + days);
    where.push(
      sql`${transaction.occurredOn} BETWEEN ${from.toISOString().slice(0, 10)} AND ${to.toISOString().slice(0, 10)}`,
    );
  }

  const rows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
      paymentMethod: transaction.paymentMethod,
      accountName: financialAccount.name,
    })
    .from(transaction)
    .innerJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .where(and(...where))
    .orderBy(desc(transaction.occurredOn));
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    occurredOn: r.occurredOn,
    description: r.description,
    paymentMethod: r.paymentMethod ?? "",
    accountName: r.accountName ?? "—",
  }));
}

export type InvoicePaymentCandidate = {
  id: string;
  amount: string;
  occurredOn: string;
  description: string;
  cleanDescription: string | null;
  paymentMethod: string | null;
  accountId: string;
  accountName: string;
};

/**
 * Candidatos pra vincular como pagamento da fatura: lançamentos de despesa
 * em conta bancária (não cartão), sem vínculo com outra fatura, dentro de
 * janela ±60 dias do vencimento, e com valor igual ao total da fatura.
 */
export async function listInvoicePaymentCandidates(
  orgId: string,
  options: {
    amount: string;
    dueDate: string;
    ownerId?: string;
  },
): Promise<InvoicePaymentCandidate[]> {
  const due = new Date(`${options.dueDate}T00:00:00`);
  const from = new Date(due);
  from.setDate(due.getDate() - 60);
  const to = new Date(due);
  to.setDate(due.getDate() + 60);
  const fromISO = from.toISOString().slice(0, 10);
  const toISO = to.toISOString().slice(0, 10);

  const where = [
    eq(transaction.organizationId, orgId),
    eq(transaction.kind, "expense"),
    eq(transaction.amount, options.amount),
    isNull(transaction.creditCardInvoiceId),
    isNull(transaction.parentTransactionId),
    isNull(transaction.transferToAccountId),
    sql`${transaction.occurredOn} BETWEEN ${fromISO} AND ${toISO}`,
    sql`${financialAccount.type} != 'credit_card'`,
    // Exclui transações já vinculadas a outra fatura
    sql`NOT EXISTS (
      SELECT 1 FROM ${creditCardInvoice} ci
      WHERE ci.organization_id = ${orgId}
        AND ci.external_payment_id = 'linked:' || ${transaction.id}
    )`,
  ];
  if (options.ownerId) {
    where.push(eq(transaction.ownerId, options.ownerId));
  }

  const rows = await db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
      cleanDescription: transaction.cleanDescription,
      paymentMethod: transaction.paymentMethod,
      accountId: transaction.accountId,
      accountName: financialAccount.name,
    })
    .from(transaction)
    .innerJoin(
      financialAccount,
      eq(transaction.accountId, financialAccount.id),
    )
    .where(and(...where))
    .orderBy(desc(transaction.occurredOn));

  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    occurredOn: r.occurredOn,
    description: r.description,
    cleanDescription: r.cleanDescription,
    paymentMethod: r.paymentMethod,
    accountId: r.accountId ?? "",
    accountName: r.accountName,
  }));
}

export async function getNextOpenInvoice(orgId: string, cardId: string) {
  const [row] = await db
    .select()
    .from(creditCardInvoice)
    .where(
      and(
        eq(creditCardInvoice.organizationId, orgId),
        eq(creditCardInvoice.accountId, cardId),
        sql`${creditCardInvoice.status} != 'paid'`,
      ),
    )
    .orderBy(asc(creditCardInvoice.periodEnd))
    .limit(1);
  return row ?? null;
}
