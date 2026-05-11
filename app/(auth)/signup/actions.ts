"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";

export type SignupState = { error?: string } | null;

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !email || !password) {
    return { error: "Preencha todos os campos." };
  }
  if (password.length < 8) {
    return { error: "A senha precisa ter ao menos 8 caracteres." };
  }

  try {
    await auth.api.signUpEmail({
      body: { name, email, password },
      headers: await headers(),
    });
  } catch (e) {
    if (e instanceof APIError) {
      const msg = e.body?.message ?? "Não foi possível criar a conta.";
      return { error: msg };
    }
    throw e;
  }

  redirect("/");
}
