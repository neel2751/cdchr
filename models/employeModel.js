import mongoose from "mongoose";

// Define the bankDetails schema
const bankDetailSchema = new mongoose.Schema({
  accountName: {
    type: String,
    required: true,
  },
  accountNumber: {
    type: Number,
    required: true,
  },
  sortCode: {
    type: Number,
    required: true,
  },
});
// Define the Full Address schema
const addressSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
  },
  streetAddress: {
    type: String,
    required: false,
  },
  city: {
    type: String,
    required: false,
  },
  zipCode: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    default: "United Kingdom", // Default to UK if not provided
  },
});

const employeSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "Please provide a firstName"],
    },
    lastName: {
      type: String,
      required: [true, "Please provide a LastName"],
    },
    email: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: Number,
      required: true,
    },
    eAddress: {
      type: addressSchema,
      required: true,
    },
    employeType: {
      type: String,
      required: true,
    },
    paymentType: {
      // MONTHLY or WEEKLY
      type: String,
      enum: ["Weekly", "Monthly"],
    },
    bankDetail: {
      type: bankDetailSchema,
      required: false,
    },
    projectSite: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectSite",
    },
    payRate: {
      type: Number,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: false,
    },
    employeRole: {
      type: String,
      required: true,
    },
    immigrationType: {
      type: String,
      required: true,
    },
    immigrationCategory: {
      type: String,
      required: false,
    },
    utr: {
      type: String,
      required: false,
    },
    employeNI: {
      type: String,
      required: false,
    },
    visaStartDate: {
      type: Date,
      required: false,
    },
    eVisaExp: {
      type: Date,
      required: false,
    },
    emergencyName: { type: String, required: true },
    emergencyPhoneNumber: { type: Number, required: false },
    emergencyRelation: { type: String, required: false },
    emergencyAddress: { type: String, required: false },
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerfied: {
      type: Boolean,
      default: false,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    statusDate: {
      type: Date,
    },
    delete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const EmployeModel =
  mongoose.models.Employe || mongoose.model("Employe", employeSchema);

export default EmployeModel;
