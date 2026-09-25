import { NextResponse } from "next/server";

import { verifyStripeSignature } from "@/lib/stripeSignature";
import {
  handleStripeEvent,
  webhookSecret,
} from "@/server/billingServer/stripeWebhook";

/**
 * Stripe's webhook endpoint.
 *
 * PUBLIC AND UNAUTHENTICATED — by necessity. Stripe cannot log in, so nothing
 * gates this but the signature, which is why lib/stripeSignature.js is a
 * separate, tested file rather than a few lines inlined here.
 *
 * proxy.js does not match /api, so this is reachable without a session. That
 * is deliberate and it is the only reason it works.
 *
 * Three framework-level details that are easy to get wrong and silent when
 * they are:
 *
 *   · `request.text()`, never `request.json()`. The signature is over the raw
 *     bytes; parsing and re-serialising changes key order and whitespace and
 *     the verification then fails for reasons that look like a wrong secret.
 *   · `force-dynamic`, so nothing is ever cached or statically evaluated.
 *   · `nodejs` runtime, because the verification uses node:crypto.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  // Raw, and read before anything else touches the request.
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  let secret = null;
  try {
    secret = await webhookSecret();
  } catch (error) {
    console.log("Could not read the Stripe webhook secret:", error?.message);
  }

  if (!secret) {
    // 500 rather than 200: this is our misconfiguration, and Stripe retrying
    // for three days is exactly the right behaviour while somebody fixes it.
    return NextResponse.json(
      { error: "Webhook is not configured" },
      { status: 500 },
    );
  }

  const verified = verifyStripeSignature({ payload, header: signature, secret });
  if (!verified.ok) {
    // The reason goes to our log and never to the caller. Telling somebody
    // why their forgery failed helps them write a better one.
    console.log("Rejected a Stripe webhook:", verified.reason);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!event?.id || !event?.type) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  // handleStripeEvent never throws; it records its own failures. A 500 here
  // would make Stripe retry an event that will fail identically every time.
  const result = await handleStripeEvent(event);
  return NextResponse.json({ received: true, outcome: result.outcome });
}

/**
 * Anything other than POST.
 *
 * Answered explicitly so a misconfigured endpoint URL shows up as a clear 405
 * in Stripe's delivery log rather than as whatever the framework does with an
 * unhandled method.
 */
export async function GET() {
  return NextResponse.json(
    { error: "This endpoint accepts POST from Stripe only" },
    { status: 405 },
  );
}
