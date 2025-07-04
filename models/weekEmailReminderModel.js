import mongoose from "mongoose";

const emailWeekReminderSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Types.ObjectId,
    },
    weekId: {
      type: mongoose.Types.ObjectId,
    },
    reminderData: Array,
    reminderCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const EmailWeekRotaReminderModel =
  mongoose.models.EmailWeekRotaReminder ||
  mongoose.model("EmailWeekRotaReminder", emailWeekReminderSchema);
export default EmailWeekRotaReminderModel;
