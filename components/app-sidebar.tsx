"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  Flag,
  HandCoins,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  PiggyBank,
  Settings,
  Tags,
  Target,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { FamilySwitcher } from "@/components/family-switcher";
import { logoutAction } from "@/lib/actions";

type Props = {
  user: { name: string; email: string };
  families: { id: string; name: string }[];
  activeId: string;
  pendingTransfers?: number;
  enabledModules?: string[];
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Quando definido, só aparece se este módulo estiver habilitado para a org. */
  module?: string;
  badgeKey?: "pendingTransfers";
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/lancamentos", label: "Lançamentos", icon: ListOrdered },
  {
    href: "/transferencias",
    label: "Transferências",
    icon: ArrowLeftRight,
    badgeKey: "pendingTransfers",
    module: "transferencias",
  },
  { href: "/contas", label: "Contas", icon: Wallet },
  {
    href: "/cartoes",
    label: "Cartões",
    icon: CreditCard,
    module: "cartoes",
  },
  {
    href: "/reembolsos",
    label: "Reembolsos",
    icon: HandCoins,
    module: "reembolsos",
  },
  { href: "/categorias", label: "Categorias", icon: Tags },
  {
    href: "/orcamento",
    label: "Orçamento",
    icon: Target,
    module: "orcamento",
  },
  {
    href: "/planos",
    label: "Planos e metas",
    icon: Flag,
    module: "planos",
  },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  {
    href: "/onde-economizar",
    label: "Onde economizar",
    icon: PiggyBank,
    module: "onde_economizar",
  },
  { href: "/familia", label: "Família", icon: Users },
  { href: "/importar", label: "Importar", icon: Upload },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppSidebar({
  user,
  families,
  activeId,
  pendingTransfers = 0,
  enabledModules = [],
}: Props) {
  const pathname = usePathname();
  const enabled = new Set(enabledModules);
  const visibleItems = items.filter((it) => !it.module || enabled.has(it.module));

  return (
    <Sidebar>
      <SidebarHeader>
        <FamilySwitcher families={families} activeId={activeId} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge =
                  item.badgeKey === "pendingTransfers" && pendingTransfers > 0
                    ? pendingTransfers
                    : null;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={active}
                    >
                      <item.icon />
                      <span className="flex-1">{item.label}</span>
                      {badge ? (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                          {badge}
                        </span>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-2 px-2 py-1.5">
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium truncate">{user.name}</span>
            <span className="text-xs text-muted-foreground truncate">
              {user.email}
            </span>
          </div>
          <form action={logoutAction}>
            <SidebarMenuButton type="submit" className="w-full">
              <LogOut />
              <span>Sair</span>
            </SidebarMenuButton>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
