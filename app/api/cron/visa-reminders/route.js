import { NextResponse } from "next/server";
import { runVisaReminderJob } from "@/server/visaServer/visaReminderJob";

// Triggered by the daily scheduler in server.mjs. Protected by a shared secret
// so the job can only be invoked internally, not from the public internet.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runVisaReminderJob();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[visa-cron] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
