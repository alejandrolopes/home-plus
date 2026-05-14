import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildCategoryTree,
  listCategories,
  type Category,
  type CategoryNode,
} from "@/lib/repos/categories";
import { lightenHex } from "@/lib/categories-display";
import { requireOrganization } from "@/lib/guards";
import { cn } from "@/lib/utils";
import {
  archiveCategoryAction,
  seedDefaultCategoriesAction,
} from "./actions";
import {
  ArchiveButton,
  CategoryFormDialog,
  SeedDefaultsButton,
} from "./category-form";

export default async function CategoriasPage() {
  const session = await requireOrganization();
  const allCategories = await listCategories(
    session.session.activeOrganizationId!,
  );
  // Categorias de transferência são neutras e gerenciadas automaticamente —
  // só aparecem no dropdown de lançamento, não nessa página.
  const categories = allCategories.filter((c) => !c.isTransfer);

  const tree = buildCategoryTree(categories);
  const incomeRoots = tree.filter((c) => c.kind === "income");
  const expenseRoots = tree.filter((c) => c.kind === "expense");
  const allParents = categories.filter((c) => !c.parentId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categorias</h1>
          <p className="text-muted-foreground">
            Organize suas receitas e despesas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {categories.length === 0 ? (
            <SeedDefaultsButton action={seedDefaultCategoriesAction} />
          ) : null}
          <CategoryFormDialog
            parents={allParents}
            trigger={
              <Button>
                <Plus className="size-4" />
                Nova categoria
              </Button>
            }
          />
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground mb-4">
            Nenhuma categoria ainda. Use o botão acima para criar a partir de um
            conjunto padrão (recomendado) ou criar uma categoria do zero.
          </p>
        </div>
      ) : null}

      <CategorySection
        title="Despesas"
        kind="expense"
        roots={expenseRoots}
        parents={allParents.filter((c) => c.kind === "expense")}
        archiveAction={archiveCategoryAction}
      />
      <CategorySection
        title="Receitas"
        kind="income"
        roots={incomeRoots}
        parents={allParents.filter((c) => c.kind === "income")}
        archiveAction={archiveCategoryAction}
      />
    </div>
  );
}

function CategorySection({
  title,
  kind,
  roots,
  parents,
  archiveAction,
}: {
  title: string;
  kind: "income" | "expense";
  roots: CategoryNode[];
  parents: Awaited<ReturnType<typeof listCategories>>;
  archiveAction: (formData: FormData) => void;
}) {
  if (roots.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <CategoryFormDialog
          defaultKind={kind}
          parents={parents}
          trigger={
            <Button variant="ghost" size="sm">
              <Plus className="size-4" />
              Adicionar
            </Button>
          }
        />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-[260px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roots.map((root) => (
              <CategoryRows
                key={root.id}
                node={root}
                parents={parents}
                archiveAction={archiveAction}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function CategoryRows({
  node,
  parents,
  archiveAction,
}: {
  node: CategoryNode;
  parents: Awaited<ReturnType<typeof listCategories>>;
  archiveAction: (formData: FormData) => void;
}) {
  return (
    <>
      <CategoryRow
        cat={node}
        parents={parents}
        archiveAction={archiveAction}
        depth={0}
        showAddSub
      />
      {node.children.map((child) => (
        <CategoryRow
          key={child.id}
          cat={child}
          parents={parents}
          archiveAction={archiveAction}
          depth={1}
          parentColor={node.color}
        />
      ))}
    </>
  );
}

function CategoryRow({
  cat,
  parents,
  archiveAction,
  depth,
  showAddSub,
  parentColor,
}: {
  cat: Category;
  parents: Awaited<ReturnType<typeof listCategories>>;
  archiveAction: (formData: FormData) => void;
  depth: number;
  showAddSub?: boolean;
  parentColor?: string | null;
}) {
  const dotColor =
    depth > 0 && parentColor ? lightenHex(parentColor) : cat.color;
  return (
    <TableRow>
      <TableCell>
        <div
          className={cn(
            "flex items-center gap-2",
            depth > 0 && "pl-6 text-muted-foreground",
          )}
        >
          {depth > 0 ? (
            <span aria-hidden className="text-muted-foreground/60 select-none">
              ↳
            </span>
          ) : null}
          {dotColor ? (
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: dotColor }}
            />
          ) : null}
          <span className={cn(depth === 0 && "font-medium")}>{cat.name}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {showAddSub ? (
            <CategoryFormDialog
              parents={parents}
              defaultKind={cat.kind}
              defaultParentId={cat.id}
              trigger={
                <Button variant="ghost" size="sm">
                  <Plus className="size-3.5" />
                  Sub
                </Button>
              }
            />
          ) : null}
          <CategoryFormDialog
            category={cat}
            parents={parents}
            trigger={
              <Button variant="ghost" size="sm">
                Editar
              </Button>
            }
          />
          <ArchiveButton action={archiveAction} id={cat.id} />
        </div>
      </TableCell>
    </TableRow>
  );
}
