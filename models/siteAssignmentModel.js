// models/SiteAssignment.js
import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const siteAssignmentSchema = new Schema(
  {
    siteId: { type: ObjectId, required: true, ref: "ProjectSite" },
    assignDate: { type: Date, required: true },
    assignedEmployees: [
      {
        // employeeId: { type: ObjectId, required: true, ref: "Employe" },
        employeeId: { type: ObjectId, required: true },
        assignedBy: { type: ObjectId },
        assignedAt: { type: Date, default: Date.now },
        isLocked: { type: Boolean, default: false }, // set to true on first clock-in
      },
    ],
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and companyId field are not attached.
applyTenantScope(siteAssignmentSchema, "SiteAssignment");

const SiteAssignmentModel =
  mongoose.models.SiteAssignment ||
  mongoose.model("SiteAssignment", siteAssignmentSchema);
export default SiteAssignmentModel;
