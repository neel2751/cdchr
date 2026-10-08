import { NextResponse } from "next/server";
import { expireCarryForwardForAllTenants } from "@/server/leaveServer/carryExpiryServer";

// Triggered by the daily scheduler in server.mjs. Protected by a shared secret
// so the job can only be invoked internally, not from the public internet.
//
// Carried-over leave days that have passed the expiry on their rule are taken
// off the balance here. The booking path already refuses them from the moment
// they expire (carriedState in lib/carryForward.js) — this is what brings the
// stored `total` and `remaining` into line with that, so an employee's own leave
// card and every report stop claiming days nobody can take.
//
// Idempotent, so a missed night or a double run costs nothing: the lapse reduces
// `carryForwarded` to the carried days actually taken, and a second pass finds
// nothing left to expire.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await expireCarryForwardForAllTenants();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[leave-carry-expiry] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
