const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return brlFormatter.format(0);
  return brlFormatter.format(n);
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return dateFormatter.format(d);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
