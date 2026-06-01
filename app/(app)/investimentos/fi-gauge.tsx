import { formatBRL } from "@/lib/format";

type Props = {
  ratio: number; // 0..∞
  avgReturnCents: number;
  avgExpenseCents: number;
  samplesReturn: number;
  samplesExpense: number;
};

/**
 * Gauge semicircular do Grau de Independência Financeira.
 * - 0% (vermelho) ... 50% (amarelo) ... 100%+ (verde)
 * - Ponteiro indica a posição do ratio, capado em 1.2 pra ficar dentro do arco.
 */
export function FIGauge({
  ratio,
  avgReturnCents,
  avgExpenseCents,
  samplesReturn,
  samplesExpense,
}: Props) {
  // 0..1.2 mapeia pra 180° (semicírculo). Acima de 100% mostra "no verde".
  const display = Math.min(1.2, Math.max(0, ratio));
  const angle = display * (180 / 1.2); // 0..180 graus
  const pct = ratio * 100;
  const pctLabel = pct >= 1000 ? "999+%" : `${pct.toFixed(1)}%`;
  const color =
    ratio >= 1 ? "#10b981" : ratio >= 0.5 ? "#f59e0b" : "#ef4444";

  const samples = Math.min(samplesReturn, samplesExpense);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-full max-w-[280px]">
        {/* arco de fundo cinza */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* arco colorido até o ratio */}
        <path
          d={describeArc(100, 100, 80, 0, angle)}
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* marca 100% no arco (linha pontilhada) */}
        <line
          x1={100 + 80 * Math.cos(((100 / 1.2) * (Math.PI / 180)) * 1 - Math.PI)}
          y1={100 + 80 * Math.sin(((100 / 1.2) * (Math.PI / 180)) * 1 - Math.PI)}
          x2={100 + 72 * Math.cos(((100 / 1.2) * (Math.PI / 180)) * 1 - Math.PI)}
          y2={100 + 72 * Math.sin(((100 / 1.2) * (Math.PI / 180)) * 1 - Math.PI)}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2"
        />
        {/* texto central */}
        <text
          x="100"
          y="90"
          textAnchor="middle"
          fontSize="26"
          fontWeight="700"
          fill="currentColor"
        >
          {pctLabel}
        </text>
        <text
          x="100"
          y="108"
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
          opacity="0.6"
        >
          {ratio >= 1
            ? "Independência atingida"
            : ratio >= 0.5
              ? "Caminho da metade"
              : "Início da jornada"}
        </text>
      </svg>

      <div className="mt-2 grid grid-cols-2 gap-3 text-xs w-full max-w-[280px]">
        <div className="text-center">
          <div className="text-muted-foreground">Rendimento médio</div>
          <div className="tabular-nums font-medium">
            {formatBRL((avgReturnCents / 100).toFixed(2))}
            <span className="text-muted-foreground"> /mês</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Despesa média</div>
          <div className="tabular-nums font-medium">
            {formatBRL((avgExpenseCents / 100).toFixed(2))}
            <span className="text-muted-foreground"> /mês</span>
          </div>
        </div>
      </div>
      {samples < 3 ? (
        <p className="text-[10px] text-muted-foreground mt-2 text-center max-w-[280px]">
          Apenas {samples} {samples === 1 ? "mês" : "meses"} de dados. Adicione
          mais snapshots ou aguarde acumular histórico para um cálculo mais
          confiável.
        </p>
      ) : null}
    </div>
  );
}

/** Helper SVG: descreve um arco entre dois ângulos (0..180 graus, em torno do centro). */
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngleDeg: number,
  endAngleDeg: number,
): string {
  // Convertemos pra coordenadas do semicírculo superior (180 = direita, 0 = esquerda)
  const polar = (deg: number) => {
    const rad = ((180 - deg) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  };
  const s = polar(startAngleDeg);
  const e = polar(endAngleDeg);
  const largeArc = endAngleDeg - startAngleDeg > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}
