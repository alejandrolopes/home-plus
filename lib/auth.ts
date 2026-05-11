import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  user: {
    changeEmail: {
      enabled: true,
      // Sem servidor de email configurado, permite trocar diretamente.
      // Quando emailVerification.sendVerificationEmail estiver setup,
      // remover esta linha e o fluxo passa a exigir confirmação.
      updateEmailWithoutVerification: true,
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
    }),
    nextCookies(),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});

export type Session = typeof auth.$Infer.Session;
