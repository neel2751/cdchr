import mongoose from "mongoose";

/**
 * Immutable, append-only history of every weekly-rota state.
 *
 * One document is written each time a WeeklyRota is created or edited, holding a
 * full snapshot of `attendanceData` at that point plus who changed it and why.
 * These records are never updated or deleted — they are the tamper-evident
 * content history required for UK record-keeping (so a later edit can never
 * silently rewrite what a rota previously said).
 */
const weeklyRotaVersionSchema = new mongoose.Schema(
  {
    // The live WeeklyRota this version belongs to.
    rotaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WeeklyRota",
      index: true,
    },
    weekStartDate: {
      type: Date,
    },
    // Monotonic version number within a rota: 1, 2, 3, ...
    version: {
      type: Number,
    },
    changeType: {
      type: String,
      enum: ["created", "updated", "restored"],
      default: "updated",
    },
    // Full immutable snapshot of the rota content at this version.
    attendanceData: {
      type: Array,
    },
    // Status carried at the time of this version (for context).
    approvedStatus: {
      type: String,
    },
    approvedCount: {
      type: Number,
    },
    // Who made the change.
    changedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    changedByName: {
      type: String,
    },
    changedByEmail: {
      type: String,
    },
    changedByRole: {
      type: String,
    },
    // Why the change was made (required when editing an existing rota).
    reason: {
      type: String,
    },
    // Human-readable summary, e.g. "2 of 9 employees changed".
    summary: {
      type: String,
    },
  },
  { timestamps: true }
);

weeklyRotaVersionSchema.index({ rotaId: 1, version: -1 });
weeklyRotaVersionSchema.index({ weekStartDate: -1 });

const WeeklyRotaVersionModel =
  mongoose.models.WeeklyRotaVersion ||
  mongoose.model("WeeklyRotaVersion", weeklyRotaVersionSchema);

export default WeeklyRotaVersionModel;
