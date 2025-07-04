import mongoose from "mongoose";

const roleTypeSchema = new mongoose.Schema(
  {
    roleTitle: { type: String, required: true },
    roleDescription: { type: String },
    isActive: { type: Boolean, default: true },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const RoleTypesModel =
  mongoose.models.RoleType || mongoose.model("RoleType", roleTypeSchema);
export default RoleTypesModel;
