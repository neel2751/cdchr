import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

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

// One right-to-work verification. Append-only: a check proves the employee's
// permission as it stood on `checkedAt`, so it is never edited or replaced —
// when the visa changes, HR records a new entry and the history is kept.
// `visaEndDate` is the expiry that was on file at the time, which is how we
// later tell whether the newest check still covers the current visa.
const rightToWorkCheckSchema = new mongoose.Schema(
  {
    checkedAt: { type: Date, required: true },
    visaEndDate: { type: Date, required: false },
    documentType: { type: String, required: false },
    shareCode: { type: String, required: false },
    note: { type: String, required: false },
    checkedBy: {
      _id: { type: mongoose.Types.ObjectId, required: false },
      name: { type: String, required: false },
      email: { type: String, required: false },
    },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
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
    // How many hours a week this employee is contracted for. "fixed" follows
    // the company-wide figure in WorkSetting, so raising that one number moves
    // everyone on it; "custom" pins this employee to `weeklyHours` instead.
    // Paid leave is valued from this: weekly hours / dayPerWeek = a day's worth.
    weeklyHourType: {
      type: String,
      enum: ["fixed", "custom"],
      default: "fixed",
    },
    weeklyHours: { type: Number, required: false }, // only when "custom"
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
    rightToWorkChecks: { type: [rightToWorkCheckSchema], default: [] },
    // Denormalised copy of the newest check date so the list can sort and
    // filter on it without unwinding the history.
    lastRightToWorkCheckDate: { type: Date, required: false },
    joinDate: { type: Date, required: true },
    endDate: { type: Date, required: false },
    emergencyName: { type: String, required: false },
    emergencyPhoneNumber: { type: Number, required: false },
    emergencyRelation: { type: String, required: false },
    emergencyAddress: { type: String, required: false },
    // This employee's exceptions to the company's carry-forward rules, one per
    // leave type.
    //
    // PER LEAVE TYPE, because the rules are. A company can carry annual leave
    // and company sick days under different limits, and "this person never
    // carries annual leave" says nothing about their sick days. A single setting
    // covering everything could not express that, and silently applied a
    // decision about one type to all of them.
    //
    // An ABSENT entry means "follow the company rule" — which is a real state
    // and has to be expressible. A boolean per type could not say it: defaulting
    // to true would make the rule unable to exclude anybody, defaulting to false
    // would make the rule pointless because nobody would carry until
    // individually ticked. So only exceptions are stored, and the list is
    // normally empty.
    //
    // "always" overrides the *eligibility* conditions — employment type,
    // department, service length, days remaining — and nothing else. It does not
    // invent a carry-forward rule where the company has none: the rule says how
    // many days may carry, and without one there is no amount to carry. See
    // carryForwardEligibility() in lib/carryForward.js.
    //
    // Deliberately absent from lib/profileFields.js, so it is not self-editable:
    // an employee must not be able to grant themselves carry-forward.
    carryForwardOverrides: {
      type: [
        {
          _id: false,
          leaveType: { type: String, required: true },
          mode: { type: String, enum: ["always", "never"], required: true },
        },
      ],
      default: [],
    },


    // Set when an admin resets the password with "require a password change"
    // on. Cleared the moment the person sets their own — auth.js routes them to
    // the change-password screen and nowhere else until they do.
    mustChangePassword: { type: Boolean, default: false },
    // Sessions issued before this instant are refused. Sessions are JWTs, so
    // there is nothing server-side to delete — the token carries its issue time
    // and auth.js compares the two. Moving this forward is what "sign out of
    // all devices" actually does.
    sessionsValidFrom: { type: Date },
    // The employee's own photo. Two fields, because they answer different
    // questions: `key` is where the bytes are, and is what the page renders
    // through /api/asset; `mediaId` is the row in Media that makes the file
    // visible in Media Management and countable against the company's storage.
    // Absent on every existing record, which reads as "no photo" — the initials
    // fallback that has always been there.
    profileImage: {
      key: { type: String, required: false },
      mediaId: { type: mongoose.Types.ObjectId, ref: "Media", required: false },
    },
    statusDate: { type: Date, required: false },
    pushSubscription: { type: Object, required: false, default: null },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(officeEmployeSchema, "OfficeEmploye");

const OfficeEmployeeModel =
  mongoose.models.OfficeEmploye ||
  mongoose.model("OfficeEmploye", officeEmployeSchema);

export default OfficeEmployeeModel;
