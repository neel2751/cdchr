import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

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

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(emailWeekReminderSchema, "EmailWeekRotaReminder");

const EmailWeekRotaReminderModel =
  mongoose.models.EmailWeekRotaReminder ||
  mongoose.model("EmailWeekRotaReminder", emailWeekReminderSchema);
export default EmailWeekRotaReminderModel;
