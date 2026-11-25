import { NextResponse } from "next/server";
import { runSubscriptionBilling } from "@/server/billingServer/subscriptionBilling";

// The daily plan billing run (server/billingServer/subscriptionBilling.js),
// triggered by the scheduler in server.mjs. It charges cards, so it is behind
// the shared secret like every other job — and does nothing but keep the
// unpaid-bill locks current until billing is switched on in the console.
export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const results = await runSubscriptionBilling();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[billing-cron] route error:", error);
    return NextResponse.json(
      { success: false, message: "Job failed" },
      { status: 500 },
    );
  }
}
