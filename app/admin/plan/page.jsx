import { redirect } from "next/navigation";

import { auth } from "@/auth";
import PlanClient from "./planClient";

export const metadata = { title: "Plan & billing" };
export const dynamic = "force-dynamic";

/**
 * The company's package, what it costs at today's numbers, how much of each
 * allowance is used, and its invoices. Super admin only — the action behind it
 * (server/billingServer/myPlanServer.js) refuses anybody else as well.
 */
export default async function PlanPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  if (session.user.role !== "superAdmin") redirect("/unauthorized");
  return <PlanClient />;
}
