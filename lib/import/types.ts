export type ImportSource = "ofx" | "csv";

export type ImportAccountKind = "bank" | "credit_card";

export type ParsedTransaction = {
  externalId: string | null;
  occurredOn: string;
  amount: string;
  kind: "income" | "expense";
  description: string;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
  isPaymentReceived?: boolean;
};

export type ParsedAccountMetadata = {
  bankName?: string;
  bankId?: string;
  accountNumber?: string;
  accountBranch?: string;
  currency?: string;
  closingBalance?: string;
};

export type ParsedImport = {
  source: ImportSource;
  accountKind: ImportAccountKind;
  metadata: ParsedAccountMetadata | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactions: ParsedTransaction[];
};
