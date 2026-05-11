import { cookies } from "next/headers";

export type ViewMode = "purchase" | "invoice";

const COOKIE_NAME = "home-plus-view";

export async function getViewMode(): Promise<ViewMode> {
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === "invoice" ? "invoice" : "purchase";
}

export const VIEW_COOKIE = COOKIE_NAME;
