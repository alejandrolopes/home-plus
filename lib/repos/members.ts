import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { invitation, member } from "@/db/schema/organizations";

export type FamilyMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  createdAt: Date;
};

export async function listFamilyMembers(orgId: string): Promise<FamilyMember[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt));

  return rows.map((r) => ({
    memberId: r.memberId,
    userId: r.userId,
    name: r.name,
    email: r.email,
    image: r.image ?? null,
    role: r.role,
    createdAt: r.createdAt,
  }));
}

export type FamilyInvitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
};

export async function listPendingInvitations(
  orgId: string,
): Promise<FamilyInvitation[]> {
  const rows = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, orgId));
  return rows
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: r.status,
      expiresAt: r.expiresAt,
      inviterId: r.inviterId,
    }));
}

const COLOR_PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
];

/**
 * Mapeia userId → cor estável para visualização (avatares, badges).
 * Determinístico: mesmo userId sempre dá a mesma cor.
 */
export function colorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % COLOR_PALETTE.length;
  return COLOR_PALETTE[idx];
}

export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}
