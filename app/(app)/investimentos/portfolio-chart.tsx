"use client";

import { useMemo, useState } from "react";
import { formatBRL } from "@/lib/format";

const MONTH_PT = [
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
  const [y, m] = month.split("-");
  return `${MONTH_PT[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

type Point = { month: string; balance: number };

export function PortfolioChart({
  points,
}: {
  points: Array<{ month: string; balanceCents: number }>;
}) {
  const parsed = useMemo<Point[]>(
    () => points.map((p) => ({ month: p.month, balance: p.balanceCents / 100 })),
    [points],
  );
  const [hover, setHover] = useState<number | null>(null);

  if (parsed.length === 0) return null;

  const width = 640;
  const height = 200;
  const padX = 12;
  const padY = 18;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const max = Math.max(...parsed.map((p) => p.balance), 1);
  const min = 0; // base sempre em zero pra contexto absoluto
  const xStep = parsed.length > 1 ? innerW / (parsed.length - 1) : 0;

  // Área preenchida abaixo da linha
  const areaPath =
    parsed
      .map((p, i) => {
        const x = padX + i * xStep;
        const y = padY + innerH - ((p.balance - min) / (max - min || 1)) * innerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ") +
    ` L ${(padX + (parsed.length - 1) * xStep).toFixed(2)} ${padY + innerH} L ${padX} ${padY + innerH} Z`;

  const linePath = parsed
    .map((p, i) => {
      const x = padX + i * xStep;
      const y = padY + innerH - ((p.balance - min) / (max - min || 1)) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const lineColor = "#0ea5e9";
  const tip = hover !== null ? parsed[hover] : null;

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

        <path d={areaPath} fill={lineColor} fillOpacity="0.10" />
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        {parsed.map((p, i) => {
          const x = padX + i * xStep;
          const y = padY + innerH - ((p.balance - min) / (max - min || 1)) * innerH;
          return (
            <circle
              key={p.month}
              cx={x}
              cy={y}
              r={hover === i ? 3.5 : 2}
              fill={lineColor}
            />
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

      <div className="flex items-center justify-between text-xs mt-2">
        <span className="text-muted-foreground">Saldo total mês a mês</span>
        {tip ? (
          <span className="tabular-nums">
            {labelOf(tip.month)}:{" "}
            <span className="font-medium">{formatBRL(tip.balance.toFixed(2))}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
