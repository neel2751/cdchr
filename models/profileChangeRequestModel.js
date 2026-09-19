import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const { Schema, model, models } = mongoose;

/**
 * An employee asking HR to correct something on their own record.
 *
 * Kept as its own collection rather than folded into the issue tickets: a
 * ticket is a conversation, and this is a proposed edit — it has a field, a
 * value before and a value after, and approving it writes that value. A queue
 * of these is triageable at a glance in a way a queue of prose is not.
 *
 * `oldValue` and `newValue` are strings whatever the field's real type. They
 * are a record of what was asked, displayed back to a human who decides; the
 * coercion to a date or a number happens once, on approval, against the field's
 * declared type in lib/profileFields.js.
 *
 * Values for bank details and the NI number never land here — those raise a
 * note with no value at all. See NOTE_ONLY_REQUESTS.
 */
const ProfileChangeRequestSchema = new Schema(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: "OfficeEmploye",
      required: true,
      index: true,
    },
    // Denormalised so the HR queue lists names without a lookup per row, and
    // still reads correctly if the employee is later renamed or archived.
    employeeName: { type: String, trim: true },
    field: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    oldValue: { type: String, default: "" },
    newValue: { type: String, default: "" },
    reason: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    decidedBy: {
      _id: { type: Schema.Types.ObjectId },
      name: { type: String, trim: true },
    },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

// One outstanding request per field per person. Without it a frustrated
// employee clicking twice puts two of the same thing in HR's queue, and
// approving both writes the same value twice with two audit rows.
ProfileChangeRequestSchema.index(
  { employeeId: 1, field: 1, status: 1 },
  { partialFilterExpression: { status: "pending" } }
);

applyTenantScope(ProfileChangeRequestSchema, "ProfileChangeRequest");

const ProfileChangeRequestModel =
  models.ProfileChangeRequest ||
  model("ProfileChangeRequest", ProfileChangeRequestSchema);

export default ProfileChangeRequestModel;
