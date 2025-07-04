// models/SiteAssignment.js
import mongoose from "mongoose";
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const siteAssignmentSchema = new Schema(
  {
    siteId: { type: ObjectId, required: true, ref: "ProjectSite" },
    assignDate: { type: Date, required: true },
    assignedEmployees: [
      {
        employeeId: { type: ObjectId, required: true, ref: "Employe" },
        assignedBy: { type: ObjectId },
        assignedAt: { type: Date, default: Date.now },
        isLocked: { type: Boolean, default: false }, // set to true on first clock-in
      },
    ],
  },
  { timestamps: true }
);

const SiteAssignmentModel =
  mongoose.models.SiteAssignment ||
  mongoose.model("SiteAssignment", siteAssignmentSchema);
export default SiteAssignmentModel;
