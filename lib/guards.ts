import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema/organizations";
import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

async function pickFirstMembershipOrgId(
  userId: string,
): Promise<string | null> {
  const [m] = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return m?.orgId ?? null;
}

export async function ensureActiveOrganization() {
  const session = await requireSession();
  if (session.session.activeOrganizationId) {
    return { orgId: session.session.activeOrganizationId, session };
  }

  const orgId = await pickFirstMembershipOrgId(session.user.id);
  if (!orgId) return { orgId: null, session };

  await auth.api.setActiveOrganization({
    body: { organizationId: orgId },
    headers: await headers(),
  });

  const updated = await getSession();
  if (!updated) redirect("/login");
  return { orgId, session: updated };
}

export async function requireOrganization() {
  const result = await ensureActiveOrganization();
  if (!result.orgId) redirect("/onboarding");
  return result.session;
}
