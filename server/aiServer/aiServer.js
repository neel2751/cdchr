import ClockModel from "@/models/clockModel";
import EmployeModel from "@/models/employeModel";
import LeaveRequestModel from "@/models/leaveRequestModel";

// Leave Management
async function getPendingLeaves({ employeeName, date }) {
  const query = { status: "pending" };
  if (employeeName) query.employeeName = employeeName;
  if (date) query.leaveDate = date;
  // we have to do populate for employeeName and approvedBy
  return LeaveRequestModel.find(query).select(
    "-_id employeeName leaveDate leaveEndDate reason"
  );
}

// Employee Management
async function getVisaExpiring({ withinDays = 30 }) {
  const today = new Date();
  const expiryDate = new Date();
  expiryDate.setDate(today.getDate() + withinDays);
  return EmployeModel.find({ eVisaExp: { $lte: expiryDate } }).select(
    "-_id employeeName eVisaExp"
  );
}

async function getClockInStatus() {
  const today = new Date().toISOString().slice(0, 10);
  return ClockModel.find({ date: today }).select("-_id employeeName clockIn");
}

async function getNotClockedOut() {
  const today = new Date().toISOString().slice(0, 10);
  return ClockModel.find({ date: today, clockOut: null }).select(
    "-_id employeeName"
  );
}

// Map AI function names to backend functions
export const functionsMap = {
  getPendingLeaves,
  getVisaExpiring,
  getClockInStatus,
  getNotClockedOut,
};
