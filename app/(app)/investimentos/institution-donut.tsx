"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/format";

// Paleta de cores estável: índice da instituição mapeia pra cor.
const PALETTE = [
  "#0ea5e9", // sky-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // rose-500
  "#a855f7", // purple-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
  "#84cc16", // lime-500
  "#ec4899", // pink-500
];

type Slice = { label: string; cents: number; color: string };

export function InstitutionDonut({
  data,
}: {
  data: Array<{ label: string; cents: number }>;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return null;

  // Ordena desc pra mostrar maiores primeiro
  const ordered = [...data].sort((a, b) => b.cents - a.cents);
  const total = ordered.reduce((s, d) => s + d.cents, 0);
  if (total === 0) return null;

  const slices: Slice[] = ordered.map((d, i) => ({
    label: d.label,
    cents: d.cents,
    color: PALETTE[i % PALETTE.length],
  }));

  // Geometria do donut
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 80;
  const innerR = 50;

  let currentAngle = -Math.PI / 2; // começa no topo
  const arcs = slices.map((s) => {
    const fraction = s.cents / total;
    const angleSweep = fraction * Math.PI * 2;
    const start = currentAngle;
    const end = currentAngle + angleSweep;
    currentAngle = end;
    return { ...s, start, end, fraction };
  });

  const polar = (radius: number, angle: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });

  const arcPath = (
    startAngle: number,
    endAngle: number,
    outerR: number,
    innerRad: number,
  ): string => {
    const startOuter = polar(outerR, startAngle);
    const endOuter = polar(outerR, endAngle);
    const startInner = polar(innerRad, endAngle);
    const endInner = polar(innerRad, startAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return [
      `M ${startOuter.x.toFixed(2)} ${startOuter.y.toFixed(2)}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x.toFixed(2)} ${endOuter.y.toFixed(2)}`,
      `L ${startInner.x.toFixed(2)} ${startInner.y.toFixed(2)}`,
      `A ${innerRad} ${innerRad} 0 ${largeArc} 0 ${endInner.x.toFixed(2)} ${endInner.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  };

  const hovered = hover !== null ? arcs[hover] : null;

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-44 h-44 shrink-0">
        {arcs.map((a, i) => {
          const isHovered = hover === i;
          const outerR = isHovered ? r + 4 : r;
          return (
            <path
              key={a.label}
              d={arcPath(a.start, a.end, outerR, innerR)}
              fill={a.color}
              opacity={hover === null || isHovered ? 1 : 0.5}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            />
          );
        })}
        {/* Texto central */}
        {hovered ? (
          <>
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              fontSize="11"
              fill="currentColor"
              opacity="0.6"
            >
              {hovered.label}
            </text>
            <text
              x={cx}
              y={cy + 10}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill="currentColor"
            >
              {(hovered.fraction * 100).toFixed(1)}%
            </text>
          </>
        ) : (
          <>
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              opacity="0.6"
            >
              Total
            </text>
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill="currentColor"
            >
              {formatBRL((total / 100).toFixed(2))}
            </text>
          </>
        )}
      </svg>

      <div className="flex-1 w-full space-y-1.5">
        {arcs.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="w-full flex items-center justify-between gap-2 text-xs px-1 py-0.5 rounded hover:bg-muted/40"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-full shrink-0"
                style={{ background: a.color }}
              />
              <span className="truncate text-left">{a.label}</span>
            </span>
            <span className="tabular-nums shrink-0">
              {formatBRL((a.cents / 100).toFixed(2))}{" "}
              <span className="text-muted-foreground">
                ({(a.fraction * 100).toFixed(1)}%)
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
