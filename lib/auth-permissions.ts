import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema/organizations";

export type MemberRole = "owner" | "admin" | "member" | string;

const ADMIN_ROLES = new Set(["owner", "admin"]);

export function isAdmin(role: MemberRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.has(role);
}

/**
 * Lê o papel do usuário na organização ativa. Retorna null se não for membro.
 */
export async function getMemberRole(
  orgId: string,
  userId: string,
): Promise<MemberRole | null> {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, orgId), eq(member.userId, userId)),
    )
    .limit(1);
  return m?.role ?? null;
}

/**
 * Pode editar um recurso se for admin OU o dono dele.
 */
export function canEdit(
  resource: { ownerId: string },
  currentUserId: string,
  role: MemberRole | null | undefined,
): boolean {
  if (resource.ownerId === currentUserId) return true;
  return isAdmin(role);
}

export class PermissionDeniedError extends Error {
  constructor(message = "Sem permissão para esta operação.") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function assertCanEdit(
  resource: { ownerId: string } | null | undefined,
  currentUserId: string,
  role: MemberRole | null | undefined,
): asserts resource is { ownerId: string } {
  if (!resource) throw new PermissionDeniedError("Recurso não encontrado.");
  if (!canEdit(resource, currentUserId, role)) {
    throw new PermissionDeniedError();
  }
}
