export type DisplayCategoryBase = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color?: string | null;
  parentId?: string | null;
  isTransfer?: boolean | null;
};

function parseHex(input: string): [number, number, number] | null {
  const s = input.trim().replace(/^#/, "");
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return [r, g, b].some(Number.isNaN) ? null : [r, g, b];
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return [r, g, b].some(Number.isNaN) ? null : [r, g, b];
  }
  return null;
}

function toHex(rgb: [number, number, number]) {
  return (
    "#" +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Mistura a cor com branco. amount 0..1; 1 = branco puro. */
export function lightenHex(hex: string, amount = 0.45): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex([
    rgb[0] + (255 - rgb[0]) * amount,
    rgb[1] + (255 - rgb[1]) * amount,
    rgb[2] + (255 - rgb[2]) * amount,
  ]);
}

/**
 * Cor de exibição: raiz usa a própria cor; subcategoria usa cor do pai clareada.
 * Fallback para a própria cor da sub se o pai não tiver cor definida.
 */
export function getCategoryDisplayColor<
  T extends { id: string; color?: string | null; parentId?: string | null },
>(cat: T, all: T[]): string | null {
  if (!cat.parentId) return cat.color ?? null;
  const parent = all.find((c) => c.id === cat.parentId);
  const base = parent?.color ?? cat.color ?? null;
  return base ? lightenHex(base) : null;
}

/**
 * Achata a árvore de categorias em uma lista pronta pra exibição num Select.
 * Não filtra por kind — qualquer categoria pode ser selecionada pra qualquer
 * transação (permite lançar income em categoria expense pra abater num
 * reembolso, ou vice-versa).
 *
 * `primaryKind` é usado só pra ordenação: categorias do mesmo kind da
 * transação aparecem primeiro, depois as do kind oposto.
 */
export function flattenForSelect<T extends DisplayCategoryBase>(
  cats: T[],
  primaryKind: "income" | "expense",
): Array<T & { depth: 0 | 1 }> {
  const idSet = new Set(cats.map((c) => c.id));
  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];

  for (const c of cats) {
    if (c.parentId && idSet.has(c.parentId)) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }

  const kindOrder = (k: "income" | "expense") =>
    k === primaryKind ? 0 : 1;

  roots.sort((a, b) => {
    const dk = kindOrder(a.kind) - kindOrder(b.kind);
    if (dk !== 0) return dk;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const out: Array<T & { depth: 0 | 1 }> = [];
  for (const r of roots) {
    out.push({ ...r, depth: 0 });
    const children = (childrenByParent.get(r.id) ?? []).slice();
    children.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const c of children) out.push({ ...c, depth: 1 });
  }
  return out;
}
