import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";
const siteAssignSchema = new mongoose.Schema(
  {
    // Site ID reference
    siteId: {
      type: mongoose.Types.ObjectId,
      ref: "ProjectSite",
      required: true, // Ensure siteId is mandatory
    },
    // Array of assigned employee IDs
    assignTo: [
      {
        type: mongoose.Types.ObjectId,
        ref: "Employe", // Reference to Employee model
        required: true, // Ensure assignTo is mandatory
      },
    ],
    // Assign date
    assignDate: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and companyId field are not attached.
applyTenantScope(siteAssignSchema, "SiteAssign");

const SiteAssignModel =
  mongoose.models.SiteAssign || mongoose.model("SiteAssign", siteAssignSchema);
export default SiteAssignModel;
