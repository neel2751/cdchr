import mongoose from "mongoose";

const officeEmployeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phoneNumber: { type: Number, required: true },
    password: { type: String, required: true },
    roleType: { type: String, required: true },
    // department: { type: String, required: true },
    department: {
      type: mongoose.Types.ObjectId,
      ref: "RoleType",
      required: true,
    },
    company: {
      type: mongoose.Types.ObjectId,
      ref: "Companie",
      required: false, // make it after true
    },
    immigrationType: { type: String, required: true },
    immigrationCategory: { type: String, required: false },
    employeType: { type: String, required: true },
    dayPerWeek: { type: Number, required: false }, // 1-7
    // hoursPerWeek: { type: Number, required: false },
    // weeksPerYear: { type: Number, required: false },
    isActive: { type: Boolean, default: true },
    isAdmin: { type: Boolean, default: false },
    isSuperAdmin: { type: Boolean, default: false },
    employeNI: { type: String, required: false },
    visaStartDate: { type: Date, required: false },
    visaEndDate: { type: Date, required: false },
    joinDate: { type: Date, required: true },
    endDate: { type: Date, required: false },
    emergencyName: { type: String, required: false },
    emergencyPhoneNumber: { type: Number, required: false },
    emergencyRelation: { type: String, required: false },
    emergencyAddress: { type: String, required: false },
    statusDate: { type: Date, required: false },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const OfficeEmployeeModel =
  mongoose.models.OfficeEmploye ||
  mongoose.model("OfficeEmploye", officeEmployeSchema);

export default OfficeEmployeeModel;
