import mongoose from "mongoose";

/**
 * Which companies a login may act as.
 *
 * An OfficeEmploye record belongs to exactly one tenant — it carries that
 * tenant's `tenantId` and the plugin filters it — so it cannot express "this
 * person also runs two other companies". Membership is that missing edge, and
 * it deliberately lives outside the tenant boundary: it has to be readable at
 * login, before any tenant is known, and a single row spans two tenants by
 * definition.
 *
 * NOT registered with the tenant plugin (see GLOBAL_MODELS) for that reason.
 */
const tenantMembershipSchema = new mongoose.Schema(
  {
    // The signing-in account. Points at OfficeEmploye today; `userModel` keeps
    // the door open for reception or platform accounts later.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userModel: {
      type: String,
      default: "OfficeEmploye",
    },
    // Denormalised so the login lookup and the platform console can search
    // without a join. Kept lowercase to match how LoginData normalises.
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Companie",
      required: true,
      index: true,
    },
    /**
     * The role this person holds *in this company*. Someone can be the super
     * admin of the company they founded and an ordinary admin in another, so
     * the role belongs on the edge rather than on the account.
     */
    role: {
      type: String,
      enum: ["superAdmin", "admin", "user"],
      default: "superAdmin",
    },
    // The company this login lands in after signing in.
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// One membership per account per company.
tenantMembershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

const TenantMembershipModel =
  mongoose.models.TenantMembership ||
  mongoose.model("TenantMembership", tenantMembershipSchema);

export default TenantMembershipModel;
