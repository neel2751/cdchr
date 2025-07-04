import mongoose from "mongoose";

const siteAssignManagerSchema = new mongoose.Schema(
  {
    loginSiteId: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    roleId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "OfficeEmploye",
    },
    projectSiteID: {
      type: mongoose.Types.ObjectId,
      ref: "ProjectSite",
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isDelete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);
const SiteAssignManagerModel =
  mongoose.models.AssignProject ||
  mongoose.model("AssignProject", siteAssignManagerSchema);

export default SiteAssignManagerModel;
