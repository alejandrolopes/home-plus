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

// Vercel Lambdas rodam em UTC; precisamos calcular "hoje" no fuso de SP.
const APP_TZ = "America/Sao_Paulo";

const spDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayParts(): { year: number; month: number; day: number } {
  const [y, m, d] = spDateFormatter.format(new Date()).split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function todayISO(): string {
  const { year, month, day } = todayParts();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function currentMonthISO(): string {
  const { year, month } = todayParts();
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthBoundsISO(year: number, month: number): {
  from: string;
  to: string;
} {
  const m = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${m}-01`,
    to: `${year}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function currentMonthBounds(): { from: string; to: string } {
  const { year, month } = todayParts();
  return monthBoundsISO(year, month);
}
