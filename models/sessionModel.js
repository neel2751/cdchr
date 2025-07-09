import mongoose from "mongoose";

// create a model for the use session
const userSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Types.ObjectId,
      required: true,
    },
    userType: {
      type: String,
      enum: ["OfficeEmploye", "Employe"],
      required: true,
    },
    platform: {
      type: String,
    },
    browser: {
      type: String,
    },
    device: {
      type: String,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    country: {
      type: String,
    },
    city: {
      type: String,
    },
    zip: {
      type: String,
    },
    latitude: {
      type: String,
    },
    longitude: {
      type: String,
    },
    isp: {
      type: String,
    },
    loginTime: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const UserSession =
  mongoose.models.UserSession ||
  mongoose.model("UserSession", userSessionSchema);
export default UserSession; // export the model
