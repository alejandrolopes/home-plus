"use server";

import { requireOrganization } from "@/lib/guards";
import {
  listLinkCandidatesForPending,
  type TransferLinkCandidate,
} from "@/lib/repos/transfer-requests";

export type LinkCandidate = TransferLinkCandidate;

export async function loadCandidatesAction(
  pendingId: string,
): Promise<LinkCandidate[]> {
  const session = await requireOrganization();
  const orgId = session.session.activeOrganizationId!;
  const userId = session.user.id;
  return listLinkCandidatesForPending(orgId, pendingId, userId);
}
