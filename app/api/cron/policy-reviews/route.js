import { NextResponse } from "next/server";
import { runPolicyReviewJob } from "@/server/policyServer/policyReviewJob";

// Triggered by the daily scheduler in server.mjs. Protected by the same shared
// secret as the other jobs, so it can only be invoked internally.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runPolicyReviewJob();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[policy-review-cron] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
