"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Props = {
  column: string;
  children: React.ReactNode;
  className?: string;
  defaultDir?: "asc" | "desc";
};

export function SortableHead({
  column,
  children,
  className,
  defaultDir = "desc",
}: Props) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const currentSort = sp.get("sort");
  const currentDir = (sp.get("dir") as "asc" | "desc" | null) ?? "desc";
  const isActive = currentSort === column;

  const toggleSort = () => {
    const next = new URLSearchParams(sp.toString());
    if (!isActive) {
      next.set("sort", column);
      next.set("dir", defaultDir);
    } else {
      next.set("sort", column);
      next.set("dir", currentDir === "asc" ? "desc" : "asc");
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <TableHead
      className={cn(
        "cursor-pointer select-none hover:bg-muted/40 group",
        className,
      )}
      onClick={toggleSort}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSort();
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isActive ? (
          currentDir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-30 group-hover:opacity-60" />
        )}
      </span>
    </TableHead>
  );
}
