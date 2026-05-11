import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/guards";
import { AcceptForm } from "./accept-form";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/login?next=/accept-invitation/${invitationId}`);
  }

  let invitation: {
    id: string;
    email: string;
    organizationName: string;
    role: string | null;
    status: string;
  } | null = null;
  let error: string | null = null;

  try {
    const inv = await auth.api.getInvitation({
      query: { id: invitationId },
      headers: await headers(),
    });
    invitation = inv
      ? {
          id: inv.id,
          email: inv.email,
          organizationName: inv.organizationName ?? "Família",
          role: inv.role ?? null,
          status: inv.status,
        }
      : null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Convite inválido.";
  }

  if (!invitation) {
    return (
      <div className="mx-auto max-w-md py-16 px-4 space-y-4">
        <h1 className="text-xl font-semibold">Convite não encontrado</h1>
        <p className="text-sm text-muted-foreground">
          {error ?? "Este convite não existe ou já foi processado."}
        </p>
        <Link href="/dashboard">
          <Button variant="outline">Voltar</Button>
        </Link>
      </div>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <div className="mx-auto max-w-md py-16 px-4 space-y-4">
        <h1 className="text-xl font-semibold">Convite não está mais ativo</h1>
        <p className="text-sm text-muted-foreground">
          Status: {invitation.status}
        </p>
        <Link href="/dashboard">
          <Button variant="outline">Voltar</Button>
        </Link>
      </div>
    );
  }

  const userEmail = session.user.email.trim().toLowerCase();
  const inviteEmail = invitation.email.trim().toLowerCase();
  const emailMatches = userEmail === inviteEmail;

  return (
    <div className="mx-auto max-w-md py-16 px-4 space-y-4">
      <h1 className="text-xl font-semibold">Convite para {invitation.organizationName}</h1>
      <p className="text-sm text-muted-foreground">
        Você foi convidado(a) como{" "}
        <span className="font-medium">{invitation.role ?? "membro"}</span> da
        família <span className="font-medium">{invitation.organizationName}</span>.
      </p>

      {!emailMatches ? (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10 p-3 text-sm">
          Este convite é para <span className="font-medium">{invitation.email}</span>,
          mas você está logado como <span className="font-medium">{session.user.email}</span>.
          Faça logout e entre com a conta correta.
        </div>
      ) : (
        <AcceptForm invitationId={invitationId} />
      )}
    </div>
  );
}
