import { redirect } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { requireOrganization } from "@/lib/guards";
import { isAdmin, getMemberRole } from "@/lib/auth-permissions";
import {
  colorForUser,
  initialsForName,
  listFamilyMembers,
  listPendingInvitations,
} from "@/lib/repos/members";
import { InviteDialog } from "./invite-dialog";
import { MemberActions } from "./member-actions";
import { CancelInvitationButton } from "./cancel-invitation-button";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dono",
  admin: "Admin",
  member: "Membro",
};

export default async function FamiliaMembrosPage() {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  const role = await getMemberRole(orgId, userId);

  if (!isAdmin(role)) {
    redirect("/familia");
  }

  const [members, invitations] = await Promise.all([
    listFamilyMembers(orgId),
    listPendingInvitations(orgId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Membros da família</h1>
          <p className="text-muted-foreground">
            {members.length} membro{members.length === 1 ? "" : "s"} ativo
            {members.length === 1 ? "" : "s"} ·{" "}
            {invitations.length} convite{invitations.length === 1 ? "" : "s"} pendente
            {invitations.length === 1 ? "" : "s"}
          </p>
        </div>
        <InviteDialog />
      </div>

      <div className="rounded-lg border divide-y">
        {members.map((m) => {
          const color = colorForUser(m.userId);
          const isSelf = m.userId === userId;
          return (
            <div
              key={m.memberId}
              className="flex items-center gap-3 p-3 flex-wrap"
            >
              <Avatar className="size-10">
                {m.image ? (
                  <AvatarImage src={m.image} alt={m.name} />
                ) : null}
                <AvatarFallback
                  style={{ backgroundColor: color, color: "#fff" }}
                >
                  {initialsForName(m.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{m.name}</span>
                  {isSelf ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Você
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.email} · entrou em {formatDate(m.createdAt)}
                </div>
              </div>
              <Badge
                variant={m.role === "owner" ? "default" : "outline"}
                className="capitalize"
              >
                {ROLE_LABEL[m.role] ?? m.role}
              </Badge>
              <MemberActions
                memberId={m.memberId}
                userId={m.userId}
                role={m.role}
                isSelf={isSelf}
              />
            </div>
          );
        })}
      </div>

      {invitations.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            Convites pendentes
          </h2>
          <div className="rounded-lg border divide-y">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 p-3 flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Como {ROLE_LABEL[inv.role ?? "member"] ?? inv.role} ·
                    expira em {formatDate(inv.expiresAt)}
                  </div>
                </div>
                <CancelInvitationButton invitationId={inv.id} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
