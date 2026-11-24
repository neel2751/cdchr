import { NextResponse } from "next/server";
import { runTrialReminderJob } from "@/server/tenantServer/trialReminderJob";

// Triggered by the daily scheduler in server.mjs, behind the same shared
// secret as the other jobs: it emails customers.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runTrialReminderJob();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[trial-reminders] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
