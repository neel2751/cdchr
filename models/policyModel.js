import mongoose from "mongoose";

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

const PolicyModel =
  mongoose.models.Policy || mongoose.model("Policy", policySchema);
export default PolicyModel; //export default PolicyModel; //export default PolicyModel; //export default Policy
