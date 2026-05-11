import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  uuid,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organizations";

export const accountType = pgEnum("account_type", [
  "checking",
  "savings",
  "cash",
  "credit_card",
  "investment",
]);

export const transactionKind = pgEnum("transaction_kind", [
  "income",
  "expense",
  "transfer",
]);

export const categoryKind = pgEnum("category_kind", ["income", "expense"]);

export const invoiceStatus = pgEnum("invoice_status", [
  "open",
  "closed",
  "paid",
]);

export const transferPendingStatus = pgEnum("transfer_pending_status", [
  "pending",
]);

export const financialAccount = pgTable(
  "financial_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    currency: text("currency").notNull().default("BRL"),
    initialBalance: numeric("initial_balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    color: text("color"),
    archived: boolean("archived").notNull().default(false),
    closingDay: integer("closing_day"),
    dueDay: integer("due_day"),
    creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
    bankName: text("bank_name"),
    bankId: text("bank_id"),
    accountNumber: text("account_number"),
    accountBranch: text("account_branch"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("financial_account_org_idx").on(t.organizationId),
    index("financial_account_owner_idx").on(t.organizationId, t.ownerId),
  ],
);

export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    parentId: uuid("parent_id"),
    color: text("color"),
    icon: text("icon"),
    archived: boolean("archived").notNull().default(false),
    isTransfer: boolean("is_transfer").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("category_org_idx").on(t.organizationId),
    index("category_parent_idx")
      .on(t.parentId)
      .where(sql`${t.parentId} IS NOT NULL`),
  ],
);

export const creditCardInvoice = pgTable(
  "credit_card_invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccount.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    status: invoiceStatus("status").notNull().default("open"),
    paidAt: timestamp("paid_at"),
    externalPaymentId: text("external_payment_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("invoice_account_idx").on(t.accountId),
    index("invoice_org_idx").on(t.organizationId),
    index("invoice_external_payment_idx")
      .on(t.organizationId, t.externalPaymentId)
      .where(sql`${t.externalPaymentId} IS NOT NULL`),
  ],
);

export const pendingPaymentStatus = pgEnum("pending_payment_status", [
  "pending",
  "linked",
  "dismissed",
]);

export const importPendingPayment = pgTable(
  "import_pending_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccount.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    occurredOn: date("occurred_on").notNull(),
    rawDescription: text("raw_description").notNull(),
    source: text("source").notNull(),
    status: pendingPaymentStatus("status").notNull().default("pending"),
    linkedInvoiceId: uuid("linked_invoice_id").references(
      () => creditCardInvoice.id,
      { onDelete: "set null" },
    ),
    importSessionId: uuid("import_session_id").references(
      () => importSession.id,
      { onDelete: "set null" },
    ),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("pending_payment_org_idx").on(t.organizationId),
    index("pending_payment_account_idx").on(t.accountId, t.status),
    index("pending_payment_external_idx").on(t.organizationId, t.externalId),
  ],
);

export const transaction = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(
      () => financialAccount.id,
      { onDelete: "set null" },
    ),
    categoryId: uuid("category_id").references(() => category.id, {
      onDelete: "set null",
    }),
    kind: transactionKind("kind").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("BRL"),
    description: text("description").notNull(),
    notes: text("notes"),
    occurredOn: date("occurred_on").notNull(),
    transferToAccountId: uuid("transfer_to_account_id").references(
      () => financialAccount.id,
      { onDelete: "set null" },
    ),
    creditCardInvoiceId: uuid("credit_card_invoice_id").references(
      () => creditCardInvoice.id,
      { onDelete: "set null" },
    ),
    paidInvoiceId: uuid("paid_invoice_id").references(
      () => creditCardInvoice.id,
      { onDelete: "set null" },
    ),
    installmentGroupId: uuid("installment_group_id"),
    installmentNumber: integer("installment_number"),
    installmentTotal: integer("installment_total"),
    purchaseDate: date("purchase_date"),
    settledAt: timestamp("settled_at"),
    discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }),
    externalId: text("external_id"),
    externalPaymentId: text("external_payment_id"),
    importSessionId: uuid("import_session_id"),
    parentTransactionId: uuid("parent_transaction_id"),
    cleanDescription: text("clean_description"),
    paymentMethod: text("payment_method"),
    counterpartyName: text("counterparty_name"),
    counterpartyDocument: text("counterparty_document"),
    counterpartyBank: text("counterparty_bank"),
    counterpartyBranch: text("counterparty_branch"),
    counterpartyAccount: text("counterparty_account"),
    isTithable: boolean("is_tithable").notNull().default(false),
    pendingStatus: transferPendingStatus("pending_status"),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("transaction_org_idx").on(t.organizationId),
    index("transaction_account_idx").on(t.accountId),
    index("transaction_occurred_on_idx").on(t.occurredOn),
    index("transaction_invoice_idx").on(t.creditCardInvoiceId),
    index("transaction_group_idx").on(t.installmentGroupId),
    index("transaction_owner_idx").on(
      t.organizationId,
      t.ownerId,
      t.occurredOn,
    ),
    index("transaction_external_idx")
      .on(t.organizationId, t.accountId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index("transaction_counterparty_idx")
      .on(t.organizationId, t.counterpartyName)
      .where(sql`${t.counterpartyName} IS NOT NULL`),
    index("transaction_payment_method_idx").on(
      t.organizationId,
      t.paymentMethod,
    ),
    index("transaction_external_payment_idx")
      .on(t.organizationId, t.externalPaymentId)
      .where(sql`${t.externalPaymentId} IS NOT NULL`),
    index("transaction_parent_idx")
      .on(t.parentTransactionId)
      .where(sql`${t.parentTransactionId} IS NOT NULL`),
    index("transaction_tithable_idx")
      .on(t.organizationId, t.occurredOn)
      .where(sql`${t.isTithable} = true`),
    index("transaction_pending_transfer_idx")
      .on(t.organizationId, t.transferToAccountId)
      .where(sql`${t.pendingStatus} = 'pending'`),
  ],
);

export const organizationFinanceSettings = pgTable(
  "organization_finance_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    tithingEnabled: boolean("tithing_enabled").notNull().default(false),
    tithingPct: numeric("tithing_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("10"),
    pactOfferingPct: numeric("pact_offering_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export const userFinanceSettings = pgTable(
  "user_finance_settings",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tithingPct: numeric("tithing_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("10"),
    pactOfferingPct: numeric("pact_offering_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const importSession = pgTable(
  "import_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccount.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    filename: text("filename"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    importedCount: integer("imported_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    accountCreated: boolean("account_created").notNull().default(false),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("import_session_org_idx").on(t.organizationId),
    index("import_session_account_idx").on(t.accountId),
  ],
);
