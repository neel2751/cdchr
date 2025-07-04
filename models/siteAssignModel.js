import mongoose from "mongoose";
const siteAssignSchema = new mongoose.Schema(
  {
    // Site ID reference
    siteId: {
      type: mongoose.Types.ObjectId,
      ref: "ProjectSite",
      required: true, // Ensure siteId is mandatory
    },
    // Array of assigned employee IDs
    assignTo: [
      {
        type: mongoose.Types.ObjectId,
        ref: "Employe", // Reference to Employee model
        required: true, // Ensure assignTo is mandatory
      },
    ],
    // Assign date
    assignDate: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const SiteAssignModel =
  mongoose.models.SiteAssign || mongoose.model("SiteAssign", siteAssignSchema);
export default SiteAssignModel;
