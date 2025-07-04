import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const CompanyModel =
  mongoose.models.Companie || mongoose.model("Companie", companySchema);
export default CompanyModel;
