import { NextResponse } from "next/server";
import { runDunningJob } from "@/server/billingServer/dunningJob";

// Triggered by the daily scheduler in server.mjs. Protected by the same shared
// secret as the other jobs — and more obviously needed here than anywhere
// else, since this one sends email to customers about money.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runDunningJob();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[dunning-cron] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
