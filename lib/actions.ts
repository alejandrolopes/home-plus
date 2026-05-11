"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/guards";
import { VIEW_COOKIE, type ViewMode } from "@/lib/preferences";

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function switchFamilyAction(organizationId: string) {
  await requireSession();
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  });
  revalidatePath("/", "layout");
}

export async function setViewModeAction(mode: ViewMode) {
  const c = await cookies();
  c.set(VIEW_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
