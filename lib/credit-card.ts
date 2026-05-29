function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function clampDay(year: number, month0: number, day: number): number {
  return Math.min(day, lastDayOfMonth(year, month0));
}

function ymd(year: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function parseISO(date: string): { y: number; m0: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m0: m - 1, d };
}

export type InvoicePeriod = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
};

export function periodForDate(
  purchaseISO: string,
  closingDay: number,
  dueDay: number,
  monthOffset = 0,
): InvoicePeriod {
  const { y, m0, d } = parseISO(purchaseISO);

  let endY = y;
  let endM0 = m0;
  if (d > closingDay) {
    endM0 += 1;
  }
  endM0 += monthOffset;
  endY += Math.floor(endM0 / 12);
  endM0 = ((endM0 % 12) + 12) % 12;

  const endDay = clampDay(endY, endM0, closingDay);
  const periodEnd = ymd(endY, endM0, endDay);

  let prevY = endY;
  let prevM0 = endM0 - 1;
  if (prevM0 < 0) {
    prevM0 = 11;
    prevY -= 1;
  }
  const prevEndDay = clampDay(prevY, prevM0, closingDay);
  const startDate = new Date(prevY, prevM0, prevEndDay + 1);
  const periodStart = ymd(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  let dueY = endY;
  let dueM0 = endM0;
  if (dueDay < closingDay) {
    dueM0 += 1;
    if (dueM0 > 11) {
      dueM0 = 0;
      dueY += 1;
    }
  }
  const actualDueDay = clampDay(dueY, dueM0, dueDay);
  const dueDate = ymd(dueY, dueM0, actualDueDay);

  return { periodStart, periodEnd, dueDate };
}

/**
 * Calcula uma due_date plausível pra um periodEnd dado, usando dueDay do cartão.
 * Regra: se dueDay < closingDay, due cai no mês seguinte; caso contrário, no
 * mesmo mês do periodEnd. Lida com clamping em meses curtos (fev/abr/...).
 */
export function deriveDueDate(
  periodEndIso: string,
  closingDay: number,
  dueDay: number,
): string {
  const { y, m0 } = parseISO(periodEndIso);
  let dueYear = y;
  let dueMonth0 = m0;
  if (dueDay < closingDay) {
    dueMonth0 += 1;
    if (dueMonth0 > 11) {
      dueMonth0 = 0;
      dueYear += 1;
    }
  }
  const day = clampDay(dueYear, dueMonth0, dueDay);
  return ymd(dueYear, dueMonth0, day);
}

/**
 * Inverso de `deriveDueDate`: a partir do vencimento + config do cartão,
 * deduz `periodStart`/`periodEnd`. Útil quando o usuário só sabe o
 * vencimento e o mês da fatura (PDF do banco frequentemente não destaca
 * o período de compras explicitamente).
 *
 * Convenção: periodStart = dia seguinte ao fechamento do ciclo anterior
 * (mesma usada por `periodForDate`).
 */
export function derivePeriodFromDueDate(
  dueIso: string,
  closingDay: number,
  dueDay: number,
): { periodStart: string; periodEnd: string } {
  const { y, m0 } = parseISO(dueIso);
  let endY = y;
  let endM0 = m0;
  if (dueDay < closingDay) {
    endM0 -= 1;
    if (endM0 < 0) {
      endM0 = 11;
      endY -= 1;
    }
  }
  const endDay = clampDay(endY, endM0, closingDay);
  const periodEnd = ymd(endY, endM0, endDay);

  let prevY = endY;
  let prevM0 = endM0 - 1;
  if (prevM0 < 0) {
    prevM0 = 11;
    prevY -= 1;
  }
  const prevEndDay = clampDay(prevY, prevM0, closingDay);
  const startDate = new Date(prevY, prevM0, prevEndDay + 1);
  const periodStart = ymd(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  return { periodStart, periodEnd };
}

export function divideAmount(total: string, parts: number): string[] {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => {
    const c = base + (i < remainder ? 1 : 0);
    return (c / 100).toFixed(2);
  });
}
