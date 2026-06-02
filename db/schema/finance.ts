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
  uniqueIndex,
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

/**
 * Estado de reembolso por lançamento. Substitui o flag `is_reimbursable` que
 * ficava na categoria — agora o usuário marca cada compra individualmente.
 *  - none: lançamento normal (default)
 *  - pending: marcado como reembolsável, aguardando o reembolso chegar
 *  - received: reembolso já recebido, mantém histórico
 */
export const reimbursableStatus = pgEnum("reimbursable_status", [
  "none",
  "pending",
  "received",
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
    /**
     * Quando false, lançamentos da categoria são ignorados em /relatorios
     * (útil pra categorias de reembolso, onde a compra e o reembolso
     * podem cair em meses diferentes e poluiriam o net mensal).
     */
    includeInReports: boolean("include_in_reports").notNull().default(true),
    /**
     * Classificação pra análise "Onde economizar":
     *  - "luxury": gasto supérfluo (potencial de corte)
     *  - "essential": despesa fixa essencial (potencial de otimização)
     *  - null: não classificada
     */
    role: text("role"),
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
    /**
     * Soma dos pagamentos (transactions com paid_invoice_id apontando aqui,
     * kind=expense). Sempre derivado por `recomputeInvoice`. totalAmount nunca
     * é mexido por pagamento — fica como bruto da fatura pra comparar com PDF.
     */
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    status: invoiceStatus("status").notNull().default("open"),
    /**
     * Quando true, fatura entra como "paid" no recompute mesmo que
     * paidAmount < totalAmount. Útil pra casos de contabilidade cruzada
     * (estornos/créditos do banco que fecham fatura anterior).
     */
    manuallyPaid: boolean("manually_paid").notNull().default(false),
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
    /**
     * Quando preenchido, esta transação ESTORNA a transação referenciada
     * (mesma conta, kinds opostos, mesmo valor ou parcial). Usada nos
     * relatórios pra zerar/abater a despesa original em vez de aparecer
     * como receita solta na mesma categoria.
     */
    reversesTransactionId: uuid("reverses_transaction_id"),
    /** Vincula a despesa a um investimento (aporte). Quando setado, o
     * snapshot do mês desse investimento é incrementado automaticamente. */
    investmentId: uuid("investment_id").references(() => investment.id, {
      onDelete: "set null",
    }),
    cleanDescription: text("clean_description"),
    paymentMethod: text("payment_method"),
    counterpartyName: text("counterparty_name"),
    counterpartyDocument: text("counterparty_document"),
    counterpartyBank: text("counterparty_bank"),
    counterpartyBranch: text("counterparty_branch"),
    counterpartyAccount: text("counterparty_account"),
    isTithable: boolean("is_tithable").notNull().default(false),
    reimbursableStatus: reimbursableStatus("reimbursable_status")
      .notNull()
      .default("none"),
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
    index("transaction_reverses_idx")
      .on(t.reversesTransactionId)
      .where(sql`${t.reversesTransactionId} IS NOT NULL`),
    index("transaction_investment_idx")
      .on(t.investmentId)
      .where(sql`${t.investmentId} IS NOT NULL`),
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

export const investmentClass = pgEnum("investment_class", [
  "fixed_income",
  "variable_income",
]);

/**
 * Investimentos individuais (produtos): CDB, Tesouro, ações, ETFs etc.
 * Diferente de financial_account.type=investment (que é a conta na corretora).
 * O acompanhamento é por snapshot mensal, não por transação.
 *
 * ownerId: null = visível pra família; userId = pessoal.
 */
export const investment = pgTable(
  "investment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    issuer: text("issuer"),
    productName: text("product_name").notNull(),
    class: investmentClass("class").notNull(),
    maturityDate: date("maturity_date"),
    color: text("color"),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("investment_org_idx").on(t.organizationId),
    index("investment_owner_idx").on(t.organizationId, t.ownerId),
  ],
);

/**
 * Snapshot do investimento por mês. `appliedCents` é o aporte feito naquele
 * mês (negativo = resgate); `balanceCents` é o saldo total no fim do mês.
 * Rendimento mensal = balance[m] - balance[m-1] - applied[m].
 */
export const investmentSnapshot = pgTable(
  "investment_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investmentId: uuid("investment_id")
      .notNull()
      .references(() => investment.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** "YYYY-MM" */
    month: text("month").notNull(),
    appliedCents: integer("applied_cents").notNull().default(0),
    balanceCents: integer("balance_cents").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("investment_snapshot_inv_idx").on(t.investmentId),
    uniqueIndex("investment_snapshot_unique").on(t.investmentId, t.month),
  ],
);

/**
 * Metas/planos de longo prazo (independência financeira, viagem, reforma,
 * reserva de emergência). owner_id=null = plano da org (família inteira vê);
 * owner_id=userId = plano pessoal (só o dono vê).
 *
 * V1: current_cents atualizado manualmente via "Adicionar aporte". V2 (futuro)
 * usará tabela plan_contribution pra histórico automático de aportes.
 */
export const plan = pgTable(
  "plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** null = plano da família (visível a todos); set = plano pessoal. */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    targetCents: integer("target_cents").notNull(),
    /**
     * Modo "manual" (legado): aportes registrados via plan_contribution.
     * Modo "vinculado": progresso = saldo da conta ou investimento vinculado.
     * Exatamente um dos dois (linked_account_id / linked_investment_id) pode
     * estar setado; null nos dois = modo manual.
     */
    currentCents: integer("current_cents").notNull().default(0),
    linkedAccountId: uuid("linked_account_id").references(
      () => financialAccount.id,
      { onDelete: "set null" },
    ),
    linkedInvestmentId: uuid("linked_investment_id").references(
      () => investment.id,
      { onDelete: "set null" },
    ),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    color: text("color"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("plan_org_idx").on(t.organizationId),
    index("plan_owner_idx").on(t.organizationId, t.ownerId),
    index("plan_linked_account_idx")
      .on(t.linkedAccountId)
      .where(sql`${t.linkedAccountId} IS NOT NULL`),
    index("plan_linked_investment_idx")
      .on(t.linkedInvestmentId)
      .where(sql`${t.linkedInvestmentId} IS NOT NULL`),
  ],
);

/**
 * Histórico de aportes/saques em um plano. Cada linha é uma movimentação.
 * Permite reconstruir o currentCents como soma e dar visibilidade do progresso.
 */
export const planContribution = pgTable(
  "plan_contribution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Quem fez o aporte (pra plano de família com vários contribuintes). */
    contributorId: text("contributor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** Negativo = saque. Cents. */
    amountCents: integer("amount_cents").notNull(),
    occurredOn: date("occurred_on").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("plan_contribution_plan_idx").on(t.planId),
    index("plan_contribution_org_idx").on(t.organizationId),
  ],
);

/**
 * Orçamento por categoria. Suporta default (month=null, aplica a todos os
 * meses) E override por mês específico (month='YYYY-MM'). Quando consulta-se
 * um mês X, a regra é: override se existir, senão default, senão 0.
 *
 * Unicidade: dois índices parciais — um pra default (mês NULL) e outro pra
 * overrides (mês NOT NULL). Postgres não trata NULLs como iguais em UNIQUE
 * comum, então a abordagem com índice parcial é a correta.
 */
export const categoryBudget = pgTable(
  "category_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    /** "YYYY-MM" ou null = default que aplica quando não há override. */
    month: text("month"),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("category_budget_org_idx").on(t.organizationId),
    uniqueIndex("category_budget_default_unique")
      .on(t.categoryId)
      .where(sql`${t.month} IS NULL`),
    uniqueIndex("category_budget_month_unique")
      .on(t.categoryId, t.month)
      .where(sql`${t.month} IS NOT NULL`),
  ],
);

/**
 * Toggle por org de módulos opcionais (cartões, reembolsos, fidelidade,
 * investimentos etc.). Ausência de linha = usar o defaultEnabled definido
 * em `lib/modules.ts`. Linha presente sobrescreve o default.
 */
export const organizationModules = pgTable(
  "organization_modules",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.moduleKey] })],
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


export const categorizationRule = pgTable(
  "categorization_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: categoryKind("kind").notNull(),
    descriptionNorm: text("description_norm").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    hitCount: integer("hit_count").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("categorization_rule_lookup_idx").on(
      t.organizationId,
      t.kind,
      t.descriptionNorm,
    ),
  ],
);
