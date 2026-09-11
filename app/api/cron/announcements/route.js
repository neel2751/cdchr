import { NextResponse } from "next/server";
import {
  countScheduled,
  runAnnouncementPublishJob,
} from "@/server/announcementServer/announcementScheduler";

// Triggered by the scheduler in server.mjs, every few minutes. Protected by a
// shared secret so the job can only be invoked internally, not from the public
// internet — publishing is not something an outsider should be able to trigger.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runAnnouncementPublishJob();
    // Reported so a run that published nothing because nothing was due reads
    // differently from one that published nothing because it is broken.
    const stillScheduled = await countScheduled();
    return NextResponse.json({ success: true, results, stillScheduled });
  } catch (error) {
    console.error("[announcement-cron] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
