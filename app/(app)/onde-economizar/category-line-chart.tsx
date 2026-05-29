"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

type Point = { month: string; total: number };

type Props = {
  points: Point[];
  color?: string | null;
  avg?: number;
  width?: number;
  height?: number;
};

/**
 * Mini gráfico de linha em SVG nativo. Mostra os pontos do histórico mensal
 * com hover tooltip e linha pontilhada na média.
 */
export function CategoryLineChart({
  points,
  color,
  avg,
  width = 320,
  height = 80,
}: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (points.length === 0) return null;

  const padX = 4;
  const padY = 8;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const max = Math.max(...points.map((p) => p.total), avg ?? 0, 1);
  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;
  const stroke = color || "#64748b";

  const pathD = points
    .map((p, i) => {
      const x = padX + i * xStep;
      const y = padY + innerH - (p.total / max) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const avgY =
    avg !== undefined ? padY + innerH - (avg / max) * innerH : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHovered(null)}
      >
        {avgY !== null ? (
          <line
            x1={padX}
            x2={width - padX}
            y1={avgY}
            y2={avgY}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
            className="text-muted-foreground/40"
          />
        ) : null}
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => {
          const x = padX + i * xStep;
          const y = padY + innerH - (p.total / max) * innerH;
          return (
            <g key={p.month}>
              <circle
                cx={x}
                cy={y}
                r={hovered === i ? 4 : 2.5}
                fill={stroke}
                className="transition-all"
              />
              <rect
                x={x - xStep / 2}
                y={0}
                width={xStep || 8}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
              />
            </g>
          );
        })}
      </svg>
      {hovered !== null ? (
        <div
          className={cn(
            "absolute -top-1 pointer-events-none translate-x-[-50%] -translate-y-full",
            "rounded bg-popover text-popover-foreground border px-2 py-1 text-[10px] shadow whitespace-nowrap",
          )}
          style={{
            left: `${((padX + hovered * xStep) / width) * 100}%`,
          }}
        >
          <div className="font-medium tabular-nums">
            {formatBRL(points[hovered].total.toFixed(2))}
          </div>
          <div className="text-muted-foreground">
            {formatMonth(points[hovered].month)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(/\.$/, "");
}
