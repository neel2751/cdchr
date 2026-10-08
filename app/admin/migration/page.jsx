import { redirect } from "next/navigation";
import { auth } from "@/auth";
import MigrationClient from "./migrationClient";

export const metadata = { title: "Import staff data" };
export const dynamic = "force-dynamic";

/**
 * Bringing an existing staff list in from another HR system.
 *
 * Super admin only, and checked here as well as in every action behind the
 * screen. The route guard in proxy.js decides who may open a page; it says
 * nothing about who may call a server action, and this one creates sign-in
 * credentials in bulk.
 */
export default async function MigrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  if (session.user.role !== "superAdmin") redirect("/unauthorized");

  return <MigrationClient />;
}
