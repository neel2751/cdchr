import mongoose, { Schema } from "mongoose";

const meetingSchema = new Schema(
  {
    employeeId: { type: mongoose.Types.ObjectId, required: true },
    title: { type: String, required: true },
    meetingData: { type: mongoose.Schema.Types.Mixed, default: {} },
    attendances: { type: Array, default: [] },
    creatorEmail: { type: String },
    createDate: { type: Date, default: new Date() },
    startDateTime: { type: Date, default: new Date() },
    endDateTime: { type: Date, default: new Date() },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

const MeetingModel =
  mongoose.models.Meeting || mongoose.model("Meeting", meetingSchema);
export default MeetingModel;
