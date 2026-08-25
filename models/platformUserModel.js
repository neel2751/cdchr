import mongoose from "mongoose";

/**
 * Provider-side staff who administer the platform itself: creating tenants,
 * managing their domains, branding and plans.
 *
 * Deliberately a separate collection from OfficeEmploye. A platform admin is
 * not an employee of any tenant, and `superAdmin` remains what it has always
 * been — the highest role *within* one company. Keeping them apart means a
 * tenant's own super admin can never be escalated into platform access by
 * flipping a boolean on their employee record.
 */
const platformUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // bcrypt hash, same hashing as office employees.
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const PlatformUserModel =
  mongoose.models.PlatformUser ||
  mongoose.model("PlatformUser", platformUserSchema);

export default PlatformUserModel;
