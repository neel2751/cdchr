import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

/**
 * Somebody on a site from a date, until a date or until further notice.
 *
 * SiteAssignment is one document per site per day, which suits a builder who
 * decides each morning who goes where. A tuition centre enrols a student in a
 * class once, for the year, and a student who joins in March starts in March;
 * making somebody re-assign every student every day was the product being
 * built for one industry. This is the other shape: one row for the whole
 * stretch.
 *
 * The two live side by side. Who is expected where on a given day is the
 * union of both — lib/roster.js answers it, and every reader (the clock-in
 * checks, the site board, the employee's own page) goes through it.
 *
 *   startDate  first day, UTC midnight of the working date
 *   endDate    last day, inclusive; null for "until further notice"
 *   days       weekdays it applies on, 0 = Sunday … 6 = Saturday, as
 *              Date#getUTCDay counts; empty means every day. A Monday and
 *              Wednesday class is [1, 3].
 *
 * Ending one sets endDate; a row is never rewritten to mean a different
 * stretch, so the history of who was on which site stays readable.
 */
const standingAssignmentSchema = new Schema(
  {
    siteId: { type: ObjectId, required: true, ref: "ProjectSite" },
    employeeId: { type: ObjectId, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    days: {
      type: [{ type: Number, min: 0, max: 6 }],
      default: [],
    },
    assignedBy: { type: ObjectId },
    endedBy: { type: ObjectId },
    endedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

standingAssignmentSchema.index({ siteId: 1, startDate: 1, endDate: 1 });
standingAssignmentSchema.index({ employeeId: 1, startDate: 1, endDate: 1 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(standingAssignmentSchema, "StandingAssignment");

const StandingAssignmentModel =
  mongoose.models.StandingAssignment ||
  mongoose.model("StandingAssignment", standingAssignmentSchema);

export default StandingAssignmentModel;
