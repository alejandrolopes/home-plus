import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/guards";

export default async function Home() {
  await requireOrganization();
  redirect("/dashboard");
}
