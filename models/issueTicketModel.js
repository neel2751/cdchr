import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const issueTicketModel = new mongoose.Schema(
  {
    title: { type: String, required: true },
    issue: { type: String, required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    trackingId: { type: String, required: true },
    ticketStatus: {
      type: String,
      enum: ["Open", "In Progress", "On Hold", "Done", "Rejected", "Closed"],
      default: "Open",
    },
    issueType: {
      type: String,
      enum: ["Bug", "Feature", "Security", "Improvement", "Other"],
    },
    isDelete: {
      type: Boolean,
      default: false,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
    },
    description: {
      type: String,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(issueTicketModel, "IssueTicket");

const IssueTicketModel =
  mongoose.models.IssueTicket ||
  mongoose.model("IssueTicket", issueTicketModel);
export default IssueTicketModel;
