export type DisplayCategoryBase = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color?: string | null;
  parentId?: string | null;
  isTransfer?: boolean | null;
};

/**
 * Achata a árvore de categorias em uma lista pronta pra exibição num Select,
 * com filhos imediatamente após a mãe e marcados com depth=1.
 * Categorias de transferência aparecem em ambos os kinds.
 */
export function flattenForSelect<T extends DisplayCategoryBase>(
  cats: T[],
  kind: "income" | "expense",
): Array<T & { depth: 0 | 1 }> {
  const filtered = cats.filter((c) => c.kind === kind || c.isTransfer === true);
  const idSet = new Set(filtered.map((c) => c.id));
  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];

  for (const c of filtered) {
    if (c.parentId && idSet.has(c.parentId)) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }

  roots.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const out: Array<T & { depth: 0 | 1 }> = [];
  for (const r of roots) {
    out.push({ ...r, depth: 0 });
    const children = (childrenByParent.get(r.id) ?? []).slice();
    children.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const c of children) out.push({ ...c, depth: 1 });
  }
  return out;
}
