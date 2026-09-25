import mongoose from "mongoose";

/**
 * Webhook events we have already dealt with.
 *
 * Stripe retries a delivery for up to three days until it gets a 2xx, and
 * explicitly does not promise to send an event only once. Without this, one
 * retry is one duplicate payment recorded against an invoice — and the second
 * one looks exactly as real as the first.
 *
 * The event id carries the uniqueness, so a duplicate is refused by the index
 * rather than by a read-then-write that two concurrent deliveries could both
 * pass.
 *
 * Platform-level: the events are ours, arriving before any tenant is known.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    source: { type: String, default: "stripe" },
    // Stripe's `evt_…`. Unique — that is the whole mechanism.
    eventId: { type: String, required: true, unique: true },
    type: String,
    // What we did about it, for anybody reading back later.
    outcome: String,
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Deliveries are worth keeping for a while and not for ever. Ninety days is
// well past Stripe's three-day retry window, so nothing is forgotten while it
// could still arrive again.
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 90 * 86400 });

const WebhookEventModel =
  mongoose.models.WebhookEvent ||
  mongoose.model("WebhookEvent", webhookEventSchema);

export default WebhookEventModel;
