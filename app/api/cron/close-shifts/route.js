import { NextResponse } from "next/server";
import { runShiftCloseJob } from "@/server/clockServer/shiftCloser";

// Triggered by the scheduler in server.mjs, once a day. Protected by the same
// shared secret as the other jobs: this writes to attendance records, which is
// not something an outsider should be able to set off.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runShiftCloseJob();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[shift-close-cron] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
