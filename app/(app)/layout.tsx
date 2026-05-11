import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { db } from "@/db";
import { member, organization } from "@/db/schema/organizations";
import { requireOrganization } from "@/lib/guards";
import { countPendingTransfersForUser } from "@/lib/repos/transfer-requests";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;

  const [memberships, pendingTransfers] = await Promise.all([
    db
      .select({ id: organization.id, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt)),
    countPendingTransfersForUser(orgId, userId),
  ]);

  if (!memberships.find((m) => m.id === orgId)) notFound();

  return (
    <SidebarProvider>
      <AppSidebar
        user={{ name: session.user.name, email: session.user.email }}
        families={memberships}
        activeId={orgId}
        pendingTransfers={pendingTransfers}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
