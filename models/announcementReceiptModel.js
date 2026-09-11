import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * One person's relationship with one announcement.
 *
 * Written lazily — on first read, not at publish time. Publishing to 400 people
 * should not write 400 documents, and most of them would never be touched
 * again. The absence of a receipt is therefore meaningful: it means unread.
 *
 * Read, acknowledged and dismissed are three different things:
 *   readAt          they opened it
 *   acknowledgedAt  they pressed "I have read this" (only when requireAck)
 *   dismissedAt     they closed the urgent banner
 * An author reporting on a safety notice needs the second, not the first.
 */
const announcementReceiptSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Office and field staff are separate collections with independent id
    // spaces, so the id alone does not identify a person. v1 only ever writes
    // "office".
    employeeKind: {
      type: String,
      enum: ["office", "field"],
      default: "office",
      required: true,
    },
    readAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    dismissedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One receipt per person per announcement. Double-clicking "acknowledge" races
// two upserts; this is what stops the second one becoming a duplicate row and
// inflating the report.
announcementReceiptSchema.index(
  { tenantId: 1, announcementId: 1, employeeId: 1 },
  { unique: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(announcementReceiptSchema, "AnnouncementReceipt");

const AnnouncementReceiptModel =
  mongoose.models.AnnouncementReceipt ||
  mongoose.model("AnnouncementReceipt", announcementReceiptSchema);

export default AnnouncementReceiptModel;
