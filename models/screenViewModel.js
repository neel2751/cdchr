import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * Which screens people actually open.
 *
 * Written to answer one question the application could not answer at all: is
 * this screen still used? The only usage signal in the product was
 * logCsvExport, which records an export rather than a visit — and with no
 * export ever recorded, every screen looked equally unused. That is how a
 * ReferenceError sat in Filter Attendance for two days: nothing says whether
 * anybody opens it.
 *
 * NOT the audit log, deliberately. auditlogs is a compliance trail of
 * privileged changes, read by a super admin on /admin/auditLogs, and page
 * views would bury it under its own volume — twenty-three rows exist in
 * production today, and one person navigating for an afternoon would add more
 * than that. Different purpose, different retention, different collection.
 *
 * ONE ROW PER PERSON, PER SCREEN, PER DAY
 *
 * The unique index is what keeps this cheap: a visit upserts and increments
 * `count` rather than appending, so the collection grows with
 * (people × screens × days they worked) instead of with every click. `day` is
 * a "yyyy-MM-dd" string rather than a Date because the question is which
 * calendar day somebody worked, and a timestamp invites a timezone to change
 * the answer.
 */
const screenViewSchema = new mongoose.Schema(
  {
    // Who. Denormalised on purpose: this is read as a report, and resolving
    // names across two employee collections per row to answer "who uses this"
    // would make the report the expensive thing.
    employeeId: { type: mongoose.Schema.Types.ObjectId },
    email: { type: String, lowercase: true, trim: true },
    name: { type: String, trim: true },
    role: { type: String },

    // What. The pathname as navigated, with record ids stripped — see
    // normaliseScreenPath() in server/auditServer/screenViews.js. Without that
    // every employee detail page would be its own "screen".
    path: { type: String, required: true },

    day: { type: String, required: true }, // yyyy-MM-dd

    count: { type: Number, default: 1 },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One row per person per screen per day — the whole reason this is affordable.
screenViewSchema.index(
  { tenantId: 1, employeeId: 1, path: 1, day: 1 },
  { unique: true }
);

// Answering "when was this screen last opened, and how often" without a scan.
screenViewSchema.index({ tenantId: 1, path: 1, lastAt: -1 });

// Usage data ages out on its own. Six months answers "is this still used"
// comfortably, and nothing here is worth keeping beyond the question it was
// collected for.
screenViewSchema.index({ lastAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

applyTenantScope(screenViewSchema, "ScreenView");

const ScreenViewModel =
  mongoose.models.ScreenView || mongoose.model("ScreenView", screenViewSchema);

export default ScreenViewModel;
