import { and, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { invitation, organization } from "@/db/schema/organizations";
import { ensureActiveOrganization } from "@/lib/guards";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const { orgId, session } = await ensureActiveOrganization();
  if (orgId) redirect("/dashboard");

  const email = session.user.email.trim().toLowerCase();

  const pendingInvites = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
        gte(invitation.expiresAt, new Date()),
      ),
    );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Home+</h1>
          <p className="text-muted-foreground text-sm">
            Bem-vindo, {session.user.name}!
          </p>
        </div>

        {pendingInvites.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="size-4" />
                {pendingInvites.length === 1
                  ? "Você tem um convite pendente"
                  : `Você tem ${pendingInvites.length} convites pendentes`}
              </CardTitle>
              <CardDescription>
                Aceite um convite para entrar numa família existente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingInvites.map((inv) => (
                <Link
                  key={inv.id}
                  href={`/accept-invitation/${inv.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted transition-colors"
                >
                  <div>
                    <div className="font-medium">{inv.organizationName}</div>
                    <div className="text-xs text-muted-foreground">
                      Como {inv.role ?? "membro"}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" type="button">
                    Aceitar
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>
              {pendingInvites.length > 0
                ? "Ou crie sua própria família"
                : "Crie sua família"}
            </CardTitle>
            <CardDescription>
              Cada família é um espaço próprio para registrar contas,
              lançamentos e cartões. Você pode convidar outros membros depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
