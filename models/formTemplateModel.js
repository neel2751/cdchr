// models/FormTemplateModel.js
import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const formTemplateSchema = new mongoose.Schema(
  {
    templateName: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmployee",
      required: true,
    },

    // This stores the array that goes into your GlobalForm
    fields: { type: Array, required: true },

    isPublic: { type: Boolean, default: false }, // If superadmin wants to share a template with everyone
    isActive: { type: Boolean, default: true }, // If the template is active or archived
    isDeleted: { type: Boolean, default: false }, // Soft delete flag
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and companyId field are not attached.
applyTenantScope(formTemplateSchema, "FormTemplate");

const FormTemplateModel =
  mongoose.models.FormTemplate ||
  mongoose.model("FormTemplate", formTemplateSchema);
export default FormTemplateModel;
