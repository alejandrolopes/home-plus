import "dotenv/config";

process.loadEnvFile?.(".env.local");

import { sql } from "drizzle-orm";
import { db } from "../db";
import { auth } from "../lib/auth";

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];
  if (!email || !newPassword) {
    console.error("usage: tsx scripts/reset-password.ts <email> <newPassword>");
    process.exit(1);
  }

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);

  const userRows = await db.execute(
    sql`SELECT id FROM "user" WHERE email = ${email}`,
  );
  if (userRows.length === 0) {
    console.error("user not found");
    process.exit(1);
  }
  const userId = (userRows[0] as { id: string }).id;

  const r = await db.execute(
    sql`UPDATE "account" SET password = ${hash}, updated_at = now() WHERE user_id = ${userId} AND provider_id = 'credential' RETURNING id`,
  );
  console.log("updated:", r.length, "row(s) for", email);
  process.exit(0);
}

main();
