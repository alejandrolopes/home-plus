export type ColumnId = "data" | "conta" | "categoria";

export type ColumnVisibility = Record<ColumnId, boolean>;

export const COLUMN_DEFS: { id: ColumnId; label: string; default: boolean }[] = [
  { id: "data", label: "Data", default: true },
  { id: "categoria", label: "Categoria", default: true },
  { id: "conta", label: "Conta", default: false },
];

export const DEFAULT_VISIBILITY: ColumnVisibility = {
  data: true,
  conta: false,
  categoria: true,
};

export const STORAGE_KEY = "lancamentos:columns";
