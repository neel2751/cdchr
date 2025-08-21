import mongoose from "mongoose";

// create a schema for the office user model
const officeUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    delete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const OfficeUserModel =
  mongoose.models.OfficeUser || mongoose.model("OfficeUser", officeUserSchema);
export default OfficeUserModel;
