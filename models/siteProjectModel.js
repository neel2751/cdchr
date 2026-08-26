import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const projectSiteSchema = new mongoose.Schema(
  {
    siteName: {
      type: String,
      required: [true, "Please provide a siteName"],
    },
    siteAddress: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["Completed", "Active", "On Hold", "No Status"],
      default: "Active",
    },
    siteType: {
      type: String,
      enum: ["Residential", "Commercial", "Industrial", "Other"],
      default: "Residential",
    },
    siteDescription: {
      type: String,
      required: false,
      maxLength: 500,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    budget: {
      type: Number,
      required: false,
    },
    statusDate: {
      type: Date,
    },
    siteDelete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);
// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(projectSiteSchema, "ProjectSite");

const ProjectSiteModel =
  mongoose.models.ProjectSite ||
  mongoose.model("ProjectSite", projectSiteSchema);

export default ProjectSiteModel;
