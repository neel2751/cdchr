import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const policySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: false },
    policy: { type: String, required: true },
    submitDate: { type: Date, default: Date.now },
    status: { type: String, default: "pending" },
    track: {
      type: Array,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(policySchema, "Policy");

const PolicyModel =
  mongoose.models.Policy || mongoose.model("Policy", policySchema);
export default PolicyModel; //export default PolicyModel; //export default PolicyModel; //export default Policy
