import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

export const CATEGORIES = ["general", "policy", "hr", "safety", "it", "event"];
export const PRIORITIES = ["normal", "important", "urgent"];
export const STATUSES = ["draft", "scheduled", "published", "archived"];
export const AUDIENCE_MODES = ["all", "roles", "departments", "sites", "people"];

/**
 * Who an announcement is for.
 *
 * `mode` picks one axis rather than combining several. "Admins in the London
 * department" is a reasonable thing to want, but supporting it doubles both the
 * resolver and the picker, and single-axis covers what companies actually ask
 * for. The other fields are stored regardless so a future combination mode is a
 * schema no-op rather than a migration.
 *
 * `sites` and `includeField` are unused in v1 — field (site) employees have no
 * portal to read an announcement in, so v1 targets office staff only. Both are
 * present now for the same reason: adding them later would mean rewriting
 * documents.
 */
const audienceSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: AUDIENCE_MODES, default: "all" },
    roles: [{ type: String }],
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: "RoleType" }],
    sites: [{ type: mongoose.Schema.Types.ObjectId, ref: "SiteProject" }],
    people: [
      {
        _id: false,
        // Office and field staff live in two different collections with
        // independent id spaces, so an id alone is ambiguous.
        kind: { type: String, enum: ["office", "field"], default: "office" },
        employeeId: { type: mongoose.Schema.Types.ObjectId, required: true },
      },
    ],
    includeField: { type: Boolean, default: false },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: "Media" },
    fileName: String,
    fileType: String,
    fileSize: Number,
    key: String,
  },
  { _id: false }
);

/** Which delivery channels this announcement uses. In-app is not optional. */
const channelsSchema = new mongoose.Schema(
  {
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
  },
  { _id: false }
);

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    // Markdown. Rendered with react-markdown, which is already a dependency.
    body: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, default: "general" },
    priority: { type: String, enum: PRIORITIES, default: "normal" },
    status: { type: String, enum: STATUSES, default: "draft" },

    audience: { type: audienceSchema, default: () => ({}) },
    attachments: { type: [attachmentSchema], default: [] },
    channels: { type: channelsSchema, default: () => ({}) },

    // Soft acknowledgement: recipients get a button and the author gets a
    // report. Nothing is blocked.
    requireAck: { type: Boolean, default: false },

    // null means "publish as soon as it is published", i.e. no scheduling.
    publishAt: { type: Date, default: null },
    // Applied as a read-time filter rather than by a sweeper job, so it cannot
    // drift out of sync with the documents.
    expiresAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },
    // Denormalised: authors leave the company, and the report still has to say
    // who sent it.
    createdByName: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },

    // Snapshot of how many people were targeted, taken at publish time. The
    // audience can be edited afterwards, so recomputing it later would silently
    // change the denominator on an old report.
    recipientCount: { type: Number, default: 0 },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// The scheduler's query: everything due to go out.
announcementSchema.index({ tenantId: 1, status: 1, publishAt: 1 });
// The two list queries — admin list and recipient list — both sort this way.
announcementSchema.index({ tenantId: 1, status: 1, publishedAt: -1 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(announcementSchema, "Announcement");

const AnnouncementModel =
  mongoose.models.Announcement ||
  mongoose.model("Announcement", announcementSchema);

export default AnnouncementModel;
