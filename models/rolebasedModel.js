import mongoose from "mongoose";

const roleBasedSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoleType",
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    permissions: [
      {
        type: String, // Store menu names directly (e.g., "Office Management")
        required: true,
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const RoleBasedModel =
  mongoose.models.RoleBased || mongoose.model("RoleBased", roleBasedSchema);
export default RoleBasedModel;
