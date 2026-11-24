import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeAccess } from "@/lib/tenantAccess";
import { homePathForRole } from "@/lib/roleHome";
import { getCompanyAccess } from "@/server/tenantServer/tenantAccessState";
import CompanyModel from "@/models/companyModel";
import { connect } from "@/db/db";
import Logout from "../employee/logout";

export const metadata = { title: "Account paused" };
export const dynamic = "force-dynamic";

/**
 * Where everybody in a locked company lands (lib/tenantAccess.js): proxy.js
 * and the portal layouts send them here.
 *
 * Says why in plain words. The super admin is told what to do and who to
 * contact; everybody else is told to ask their manager. Nothing has been
 * deleted, and the page says so — the first thing anyone fears.
 *
 * Outside the proxy's matcher on purpose, so it can never redirect to itself.
 * It checks the session itself instead.
 */
export default async function AccountPausedPage() {
  const session = await auth();
  const user = session?.user;
  if (!user) redirect("/auth");

  const access = await getCompanyAccess(user.tenantId, { fresh: true });
  // Unlocked since they were sent here — back to work.
  if (access.level !== "locked") redirect(homePathForRole(user.role));

  const owner = user.role === "superAdmin";
  let companyName = "";
  try {
    await connect();
    const company = await CompanyModel.findById(user.tenantId).select("name").lean();
    companyName = company?.name || "";
  } catch {
    // The name is a courtesy; the page stands without it.
  }
  const contact = process.env.PLATFORM_SUPPORT_EMAIL || "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
            <Lock className="size-6" aria-hidden />
          </div>
          <CardTitle className="text-xl">
            {companyName ? `${companyName} is paused` : "This account is paused"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm">
          <p>{describeAccess(access, { owner })}</p>
          <p className="text-muted-foreground">
            Nothing has been deleted. Everything is exactly where you left it
            and comes back as soon as the account is reopened.
          </p>
          {owner && contact && (
            <p>
              To reopen it, email{" "}
              <a
                className="font-medium underline underline-offset-2"
                href={`mailto:${contact}?subject=${encodeURIComponent(
                  `Reopen ${companyName || "our account"}`
                )}`}
              >
                {contact}
              </a>
              .
            </p>
          )}
          <div className="flex justify-center pt-2">
            <Logout variant="outline" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
