import { eq } from "drizzle-orm";
import Link from "next/link";
import { LogOut, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/db";
import { organization } from "@/db/schema/organizations";
import { logoutAction } from "@/lib/actions";
import { getMemberRole, isAdmin } from "@/lib/auth-permissions";
import { requireOrganization } from "@/lib/guards";
import { getViewMode } from "@/lib/preferences";
import { getEffectiveFinanceSettings } from "@/lib/repos/finance-settings";
import { colorForUser, initialsForName } from "@/lib/repos/members";
import { FamilyNameForm } from "./family-name-form";
import { FidelidadeForm } from "./fidelidade-form";
import { ProfileForm } from "./profile-form";
import { ViewModePicker } from "./view-mode-picker";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dono",
  admin: "Admin",
  member: "Membro",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {children}
    </CardTitle>
  );
}

function SubSectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default async function ConfiguracoesPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);
  const view = await getViewMode();
  const color = colorForUser(userId);
  const isAdminRole = isAdmin(role);

  const [[org], fidelidade] = await Promise.all([
    db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1),
    getEffectiveFinanceSettings(orgId, userId),
  ]);

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Perfil, família e preferências.
        </p>
      </div>

      <Card>
        <CardHeader>
          <SectionTitle>Perfil</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-12 shrink-0">
              {session.user.image ? (
                <AvatarImage
                  src={session.user.image}
                  alt={session.user.name}
                />
              ) : null}
              <AvatarFallback
                style={{ backgroundColor: color, color: "#fff" }}
                className="text-sm font-medium"
              >
                {initialsForName(session.user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {session.user.name}
                </span>
                {role ? (
                  <Badge variant="outline" className="text-[10px]">
                    {ROLE_LABEL[role] ?? role}
                  </Badge>
                ) : null}
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {session.user.email}
              </div>
            </div>
          </div>
          <Separator />
          <ProfileForm
            initialName={session.user.name}
            initialEmail={session.user.email}
          />
        </CardContent>
      </Card>

      {isAdminRole ? (
        <Card>
          <CardHeader>
            <SectionTitle>Família</SectionTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FamilyNameForm initial={org?.name ?? ""} />
            <Separator />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <SubSectionHeader
                title="Membros e papéis"
                description="Convidar, promover, rebaixar ou remover."
              />
              <Link
                href="/familia/membros"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Users className="size-3.5" />
                Gerenciar
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <SectionTitle>Preferências</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <SubSectionHeader
              title="Visualização padrão"
              description="Como os lançamentos de cartão são datados nas listas e relatórios."
            />
            <ViewModePicker initial={view} />
          </div>

          <Separator />
          <div className="space-y-3">
            <SubSectionHeader
              title="Fidelidade"
              description={
                isAdminRole
                  ? "Liga/desliga é por família; % são individuais."
                  : "Dízimo e oferta pacto estimados sobre receitas dizimáveis."
              }
            />
            <FidelidadeForm initial={fidelidade} canToggleEnabled={isAdminRole} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 px-1 pt-1 text-xs text-muted-foreground">
        <span className="truncate">
          Logado como{" "}
          <span className="font-medium text-foreground">
            {session.user.email}
          </span>
        </span>
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
          >
            <LogOut className="size-3.5" />
            Sair
          </Button>
        </form>
      </div>
    </div>
  );
}
