"use client";

import { useMemo, useState } from "react";
import { formatBRL } from "@/lib/format";

type Point = { month: string; income: number; expense: number };

const MONTH_LABEL_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

function labelOf(month: string): string {
  const [, m] = month.split("-");
  const idx = Number(m) - 1;
  return MONTH_LABEL_PT[idx] ?? month;
}

export function IncomeExpenseChart({
  points,
}: {
  points: Array<{ month: string; income: string; expense: string }>;
}) {
  const parsed = useMemo<Point[]>(
    () =>
      points.map((p) => ({
        month: p.month,
        income: Number(p.income),
        expense: Number(p.expense),
      })),
    [points],
  );
  const [hover, setHover] = useState<number | null>(null);

  if (parsed.length === 0) return null;

  const width = 640;
  const height = 180;
  const padX = 12;
  const padY = 14;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const max = Math.max(
    ...parsed.map((p) => Math.max(p.income, p.expense)),
    1,
  );
  const xStep = parsed.length > 1 ? innerW / (parsed.length - 1) : 0;

  const pathFor = (key: "income" | "expense") =>
    parsed
      .map((p, i) => {
        const x = padX + i * xStep;
        const y = padY + innerH - (p[key] / max) * innerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  const incomeColor = "#10b981"; // emerald-500
  const expenseColor = "#f43f5e"; // rose-500

  const tooltipPoint = hover !== null ? parsed[hover] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width - padX;
          const idx = Math.round(x / xStep);
          if (idx >= 0 && idx < parsed.length) setHover(idx);
        }}
      >
        {/* eixo base */}
        <line
          x1={padX}
          y1={padY + innerH}
          x2={padX + innerW}
          y2={padY + innerH}
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth="1"
        />

        <path
          d={pathFor("income")}
          fill="none"
          stroke={incomeColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathFor("expense")}
          fill="none"
          stroke={expenseColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        {parsed.map((p, i) => {
          const x = padX + i * xStep;
          return (
            <g key={p.month}>
              <circle
                cx={x}
                cy={padY + innerH - (p.income / max) * innerH}
                r={hover === i ? 3.5 : 2}
                fill={incomeColor}
              />
              <circle
                cx={x}
                cy={padY + innerH - (p.expense / max) * innerH}
                r={hover === i ? 3.5 : 2}
                fill={expenseColor}
              />
            </g>
          );
        })}

        {hover !== null ? (
          <line
            x1={padX + hover * xStep}
            y1={padY}
            x2={padX + hover * xStep}
            y2={padY + innerH}
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeDasharray="2 2"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      <div className="flex justify-between text-[10px] text-muted-foreground px-3 mt-1">
        {parsed.map((p) => (
          <span key={p.month}>{labelOf(p.month)}</span>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: incomeColor }}
          />
          Receitas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: expenseColor }}
          />
          Despesas
        </span>
        {tooltipPoint ? (
          <span className="ml-auto text-muted-foreground tabular-nums">
            {labelOf(tooltipPoint.month)}:{" "}
            <span className="text-emerald-600">
              {formatBRL(tooltipPoint.income.toFixed(2))}
            </span>{" "}
            ·{" "}
            <span className="text-rose-600">
              {formatBRL(tooltipPoint.expense.toFixed(2))}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
