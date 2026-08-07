import mongoose from "mongoose";

// Bank account details. Every field is optional so office employees created
// before this was captured can still be saved.
const bankDetailSchema = new mongoose.Schema(
  {
    accountName: { type: String, required: false },
    bankName: { type: String, required: false },
    accountNumber: { type: Number, required: false },
    sortCode: { type: Number, required: false },
  },
  { _id: false }
);

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
    employeId: { type: String, required: false },
    dateOfBirth: { type: Date, required: false },
    immigrationType: { type: String, required: true },
    immigrationCategory: { type: String, required: false },
    employeType: { type: String, required: true },
    dayPerWeek: { type: Number, required: false }, // 1-7
    // hoursPerWeek: { type: Number, required: false },
    // weeksPerYear: { type: Number, required: false },
    isActive: { type: Boolean, default: true },
    isAdmin: { type: Boolean, default: false },
    isSuperAdmin: { type: Boolean, default: false },
    countryOfWork: { type: String, required: false },
    isShowenInWeeklyTimesheet: { type: Boolean, default: true },
    employeNI: { type: String, required: false },
    // Home address. `country` defaults to the UK — the form only asks for it
    // when the employee is not British.
    address: { type: String, required: false },
    streetAddress: { type: String, required: false },
    city: { type: String, required: false },
    postCode: { type: String, required: false },
    country: { type: String, required: false, default: "United Kingdom" },
    bankDetail: { type: bankDetailSchema, required: false },
    visaStartDate: { type: Date, required: false },
    visaEndDate: { type: Date, required: false },
    joinDate: { type: Date, required: true },
    endDate: { type: Date, required: false },
    emergencyName: { type: String, required: false },
    emergencyPhoneNumber: { type: Number, required: false },
    emergencyRelation: { type: String, required: false },
    emergencyAddress: { type: String, required: false },
    statusDate: { type: Date, required: false },
    pushSubscription: { type: Object, required: false, default: null },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const OfficeEmployeeModel =
  mongoose.models.OfficeEmploye ||
  mongoose.model("OfficeEmploye", officeEmployeSchema);

export default OfficeEmployeeModel;
