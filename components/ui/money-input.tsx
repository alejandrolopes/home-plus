"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

const reaisFormatter = new Intl.NumberFormat("pt-BR");

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}R$ ${reaisFormatter.format(reais)},${String(c).padStart(2, "0")}`;
}

function parseInitial(v: string | number | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

type Props = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  /** Valor inicial em formato decimal (ex: "1234.56" ou 1234.56). */
  defaultValue?: string | number;
  /** Valor controlado (string decimal). Se passado, sobrepõe estado interno. */
  value?: string | number;
  /** Permite valores negativos via prefixo "-" (default: false). */
  allowNegative?: boolean;
  /** Nome do hidden input que vai pro FormData (ex: "amount"). */
  name?: string;
  /** Notificado quando o valor decimal muda (string com ponto, ex: "12.34"). */
  onValueChange?: (decimal: string) => void;
};

export function MoneyInput({
  defaultValue,
  value,
  allowNegative = false,
  name,
  onValueChange,
  className,
  ...rest
}: Props) {
  const isControlled = value !== undefined;
  const [internalCents, setInternalCents] = React.useState<number>(() =>
    Math.abs(parseInitial(defaultValue)),
  );
  const [internalNegative, setInternalNegative] = React.useState<boolean>(
    () => parseInitial(defaultValue) < 0,
  );

  const cents = isControlled
    ? Math.abs(parseInitial(value))
    : internalCents;
  const negative = isControlled
    ? parseInitial(value) < 0
    : internalNegative;

  const display = formatCents(negative ? -cents : cents);
  const decimalString = (((negative ? -1 : 1) * cents) / 100).toFixed(2);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const isNeg = allowNegative && raw.trim().startsWith("-");
    const digits = raw.replace(/\D/g, "");
    const next = digits.length === 0 ? 0 : Number(digits);
    if (!isControlled) {
      setInternalCents(next);
      setInternalNegative(isNeg);
    }
    onValueChange?.((((isNeg ? -1 : 1) * next) / 100).toFixed(2));
  };

  return (
    <>
      <Input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className={className}
        {...rest}
      />
      {name ? (
        <input type="hidden" name={name} value={decimalString} />
      ) : null}
    </>
  );
}
