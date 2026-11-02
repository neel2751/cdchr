import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * A shelf in a company's policy library: HR, IT, Fire Safety, and whatever
 * else the company adds.
 *
 * Every company starts with the same few (DEFAULT_POLICY_CATEGORIES, created
 * the first time the library is opened) and can rename, add to or archive
 * them. Archived rather than deleted, because a category is how an old policy
 * is found again, and a delete would orphan everything filed under it.
 *
 * `nameKey` is the name folded for comparison, so "fire safety" and
 * "Fire Safety " are one category rather than two shelves nobody can tell
 * apart. It covers archived ones too: re-creating an archived category brings
 * the old one back, with its policies, instead of starting an empty twin.
 */
const policyCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true },
    description: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },
  },
  { timestamps: true },
);

policyCategorySchema.index({ tenantId: 1, nameKey: 1 }, { unique: true });

applyTenantScope(policyCategorySchema, "PolicyCategory");

const PolicyCategoryModel =
  mongoose.models.PolicyCategory ||
  mongoose.model("PolicyCategory", policyCategorySchema);

export default PolicyCategoryModel;
