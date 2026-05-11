import "dotenv/config";

process.loadEnvFile?.(".env.local");

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  category,
  creditCardInvoice,
  financialAccount,
  transaction,
} from "../db/schema/finance";
import { organization } from "../db/schema/organizations";
import { user } from "../db/schema/auth";
import { divideAmount, periodForDate } from "../lib/credit-card";

const SEED_USER_EMAIL = "alejandro@homeplus.test";
const SEED_ORG_NAME = "Família Lopes";

async function main() {
  const [u] = await db
    .select()
    .from(user)
    .where(eq(user.email, SEED_USER_EMAIL))
    .limit(1);
  if (!u) {
    console.error(
      `Seed só roda para ${SEED_USER_EMAIL}. Crie esse usuário antes (signup) e rode de novo.`,
    );
    process.exit(1);
  }

  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.name, SEED_ORG_NAME))
    .limit(1);
  if (!org) {
    console.error(
      `Família "${SEED_ORG_NAME}" não encontrada para ${u.email}. Crie no onboarding e rode de novo.`,
    );
    process.exit(1);
  }

  console.log(`Seeding org ${org.name} (${org.id}) for user ${u.email}`);

  // Wipe demo data for the org
  await db.delete(transaction).where(eq(transaction.organizationId, org.id));
  await db
    .delete(creditCardInvoice)
    .where(eq(creditCardInvoice.organizationId, org.id));
  await db
    .delete(financialAccount)
    .where(eq(financialAccount.organizationId, org.id));
  await db.delete(category).where(eq(category.organizationId, org.id));

  // Categories
  const [salario] = await db
    .insert(category)
    .values({
      organizationId: org.id,
      name: "Salário",
      kind: "income",
      color: "#10b981",
    })
    .returning();
  const [mercado] = await db
    .insert(category)
    .values({
      organizationId: org.id,
      name: "Mercado",
      kind: "expense",
      color: "#f97316",
    })
    .returning();
  const [transp] = await db
    .insert(category)
    .values({
      organizationId: org.id,
      name: "Transporte",
      kind: "expense",
      color: "#3b82f6",
    })
    .returning();

  // Accounts
  const [corrente] = await db
    .insert(financialAccount)
    .values({
      organizationId: org.id,
      ownerId: u.id,
      name: "Conta Corrente",
      type: "checking",
      initialBalance: "5000.00",
      color: "#0ea5e9",
    })
    .returning();
  const [card] = await db
    .insert(financialAccount)
    .values({
      organizationId: org.id,
      ownerId: u.id,
      name: "Cartão Nubank",
      type: "credit_card",
      initialBalance: "0",
      color: "#8b5cf6",
      closingDay: 5,
      dueDay: 12,
      creditLimit: "8000.00",
    })
    .returning();

  // Plain transactions
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  await db.insert(transaction).values([
    {
      organizationId: org.id,
      accountId: corrente.id,
      categoryId: salario.id,
      kind: "income",
      amount: "7500.00",
      description: "Salário do mês",
      occurredOn: fmt(new Date(today.getFullYear(), today.getMonth(), 5)),
      createdById: u.id,
      ownerId: u.id,
    },
    {
      organizationId: org.id,
      accountId: corrente.id,
      categoryId: mercado.id,
      kind: "expense",
      amount: "240.50",
      description: "Mercado da semana",
      occurredOn: fmt(new Date(today.getFullYear(), today.getMonth(), 10)),
      createdById: u.id,
      ownerId: u.id,
    },
  ]);

  // Credit card transactions
  // Single purchase
  const purchase1Date = fmt(today);
  const period1 = periodForDate(purchase1Date, card.closingDay!, card.dueDay!);
  const [inv1] = await db
    .insert(creditCardInvoice)
    .values({
      organizationId: org.id,
      accountId: card.id,
      periodStart: period1.periodStart,
      periodEnd: period1.periodEnd,
      dueDate: period1.dueDate,
      totalAmount: "0",
    })
    .returning();
  await db.insert(transaction).values({
    organizationId: org.id,
    accountId: card.id,
    categoryId: transp.id,
    kind: "expense",
    amount: "180.00",
    description: "Uber",
    occurredOn: period1.periodEnd,
    purchaseDate: purchase1Date,
    creditCardInvoiceId: inv1.id,
    createdById: u.id,
    ownerId: u.id,
  });
  await db
    .update(creditCardInvoice)
    .set({ totalAmount: sql`${creditCardInvoice.totalAmount} + 180.00` })
    .where(eq(creditCardInvoice.id, inv1.id));

  // Installment purchase: 1200 in 6x
  const groupId = randomUUID();
  const parts = divideAmount("1200.00", 6);
  for (let i = 0; i < 6; i++) {
    const period = periodForDate(
      purchase1Date,
      card.closingDay!,
      card.dueDay!,
      i,
    );
    const existing = await db
      .select()
      .from(creditCardInvoice)
      .where(eq(creditCardInvoice.periodEnd, period.periodEnd))
      .limit(1);
    let invId: string;
    if (existing[0]) {
      invId = existing[0].id;
    } else {
      const [created] = await db
        .insert(creditCardInvoice)
        .values({
          organizationId: org.id,
          accountId: card.id,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          dueDate: period.dueDate,
          totalAmount: "0",
        })
        .returning();
      invId = created.id;
    }
    await db.insert(transaction).values({
      organizationId: org.id,
      accountId: card.id,
      categoryId: mercado.id,
      kind: "expense",
      amount: parts[i],
      description: `Geladeira (${i + 1}/6)`,
      occurredOn: period.periodEnd,
      purchaseDate: purchase1Date,
      creditCardInvoiceId: invId,
      installmentGroupId: groupId,
      installmentNumber: i + 1,
      installmentTotal: 6,
      createdById: u.id,
      ownerId: u.id,
    });
    await db
      .update(creditCardInvoice)
      .set({ totalAmount: sql`${creditCardInvoice.totalAmount} + ${parts[i]}` })
      .where(eq(creditCardInvoice.id, invId));
  }

  console.log("Seeded successfully.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
