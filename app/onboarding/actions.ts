"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";

export type OnboardingState = { error?: string } | null;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createFamilyAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Informe o nome da família." };

  const baseSlug = slugify(name) || "familia";
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    const org = await auth.api.createOrganization({
      body: { name, slug },
      headers: await headers(),
    });
    if (!org) return { error: "Não foi possível criar a família." };

    await auth.api.setActiveOrganization({
      body: { organizationId: org.id },
      headers: await headers(),
    });
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "Erro ao criar família." };
    }
    throw e;
  }

  redirect("/dashboard");
}
