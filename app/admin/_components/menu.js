"use client";

import {
  HomeIcon,
  SirenIcon,
  TimerIcon,
  LayoutListIcon,
  FileLockIcon,
  ScrollTextIcon,
  TentTreeIcon,
  ScrollText,
  LockIcon,
  GlobeLockIcon,
  CalendarIcon,
  EditIcon,
  CableCar,
  ClipboardPlus,
  ScanQrCodeIcon,
  SettingsIcon,
  Settings,
} from "lucide-react";
import Overview from "../leaveManagement/components/overview/overview";
import LeaveCategoryNew from "../leaveManagement/components/leaveCategory/leave-category";
import { LeaveRequestForm } from "../leaveManagement/components/leaveRequest/request";
import EmployeeLeaveEntitlement from "../leaveManagement/components/leaveEntitlements/leaveEntitlement";
import RequestOff from "../leaveManagement/components/reuqestOff/requestOff";
import LeaveHistory from "../leaveManagement/components/leaveHistory/leaveHistory";
import { BankHoliday } from "../leaveManagement/components/bankHoliday";
import HolidayPlannerCalendar from "../leaveManagement/components/leaveSettings/leaveHolidayPlanner";
import LeaveReport from "../leaveManagement/components/leaveReport/leaveReport";
import EmployeeOverview from "@/components/tabs/employee-overview";
import EmployeeTimeOff from "@/components/tabs/employee-time-off";
import EmployeeFiles from "@/components/tabs/employee-files";
import EmployeePerformance from "@/components/tabs/employee-performance";
import PasswordChange from "@/components/tabs/password-change";
import SessionManagement from "@/components/tabs/session-management";
import EmployeeWeeklyRota from "@/components/tabs/weekly-rota";
import LeaveRequests from "@/components/tabs/leave-requests";
import EmployeeOnboarding from "@/components/tabs/employee-onboarding";
import {
  EmployeeOtherDeatils,
  EmployeeLeaveDeatails,
} from "../officeEmployee/components/employeeOtherDeatils";
import EmployeeEdit from "@/components/tabs/employee-edit";
import { AddEmploeeLeave } from "../leaveManagement/components/addEmployeeLeave/addEmplyoeeLeave";
import EmployeeSiteManagement from "../siteAssignEmployee/test";
import QRDialog from "../siteAssign/features/siteScan";
import ScanQrcode from "@/components/2FA/scanQrcode";
import SiteExpense from "../siteAssign/features/siteExpense";
import { SiteEmployeeOtherDeatils } from "../employee/components/employeeOtherDeatils";
import EmployeDocument from "../employee/components/employeDocument";
import OfficeEmployeeAttendance from "@/components/tabs/employee-attendance";
import CarryForwardSettings from "../leaveManagement/components/leaveSettings/carryForwardSettings";
import LeaveReports from "../report/leaveReport/leaveReport";
import AttendanceReport from "../report/attendanceReport/attendanceReport";

export const officeMenu = [
  {
    name: "Overview",
    icon: HomeIcon,
    link: "overview",
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  {
    name: "Edit",
    icon: EditIcon,
    link: "edit",
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  //   {
  //     name: "Compensation",
  //     link: "compensation",
  //     icon: SirenIcon,
  //   },
  // {
  //   name: "Time Off",
  //   link: "timeoff",
  //   icon: TimerIcon,
  // },
  {
    name: "Weekly Rota",
    link: "weeklyrota",
    icon: TimerIcon,
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  {
    name: "Attendance",
    link: "attendance",
    icon: ScanQrCodeIcon,
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  // {
  //   name: "Performance",
  //   link: "performance",
  //   icon: LayoutListIcon,
  // },
  {
    name: "Document",
    link: "document",
    icon: FileLockIcon,
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  // {
  //   name: "OnBoarding",
  //   link: "onboarding",
  //   icon: ScrollTextIcon,
  // },
  {
    name: "Password",
    link: "password",
    icon: LockIcon,
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  {
    name: "Leave",
    link: "leave",
    icon: CalendarIcon,
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  {
    name: "Bank Holiday",
    link: "bankholiday",
    icon: CableCar,
    role: ["superAdmin", "admin", "siteadmin", "employee", "user"],
  },
  {
    name: "Session",
    link: "session",
    icon: GlobeLockIcon,
    role: ["superAdmin", "admin", "employee", "user"],
  },
];

export const siteEmployeeMenu = [
  {
    name: "Overview",
    icon: HomeIcon,
    link: "overview",
    role: ["superadmin", "admin", "siteadmin", "employee"],
  },
  // {
  //   name: "Edit",
  //   icon: EditIcon,
  //   link: "edit",
  //   role: ["superadmin", "admin", "siteadmin", "employee"],
  // },
  {
    name: "Document",
    link: "document",
    icon: FileLockIcon,
    role: ["superadmin", "admin"],
  },
  {
    name: "Password",
    link: "password",
    icon: LockIcon,
    role: ["superadmin", "admin", "siteadmin", "employee"],
  },
  // {
  //   name: "Session",
  //   link: "session",
  //   icon: GlobeLockIcon,
  //   role: ["superadmin", "admin", "employee"],
  // },
];

export const leaveMenu = [
  {
    name: "Dashboard",
    icon: HomeIcon,
    link: "overview",
  },
  {
    name: "Entitlements",
    link: "entitlement",
    //   content: <EmployeeLeaveEntitlement />,
    icon: SirenIcon,
  },
  // {
  //   name: "Request Off",
  //   link: "requestoff",
  //   //   content: <LeaveRequestForm />,
  //   icon: TimerIcon,
  // },
  {
    name: "Category",
    link: "category",
    icon: LayoutListIcon,
  },
  {
    name: "Request",
    link: "request",
    //   content: <LeaveRequestForm />,
    icon: TentTreeIcon,
  },

  // {
  //   name: "Add Leave For Employee",
  //   link: "addleaveEmployee",
  //   icon: ClipboardPlus,
  // },

  // {
  //   name: "History",
  //   link: "history",
  //   //   content: <EmployeeLeaveDetails />,
  //   icon: GalleryVerticalEnd,
  // },
  {
    name: "Holiday Calendar",
    link: "holidaycalendar",
    icon: CalendarIcon,
  },
  {
    name: "Bank Holiday",
    link: "bankholiday",
    icon: ScrollText,
  },
  // {
  //   name: "Report",
  //   link: "report",
  //   //   content: <LeaveEntitlementCalculator />,
  //   icon: SquareChartGantt,
  // },
  {
    name: "Settings",
    link: "settings",
    //   content: <ParentalLeaveCalculator />,
    icon: Settings,
  },

  // {
  //   name: "Help",
  //   link: "help",
  //   icon: BadgeHelp,
  // },
];

export const siteMenu = [
  {
    name: "Dashboard",
    icon: HomeIcon,
    link: "overview",
  },
  // {
  //   name: "Scan QR",
  //   icon: ScanQrCodeIcon,
  //   link: "scan",
  // },
  // {
  //   name: "Employee",
  //   icon: TimerIcon,
  //   link: "employee",
  // },
  // {
  //   name: "Expense",
  //   icon: ClipboardPlus,
  //   link: "expense",
  // },
  // {
  //   name: "Site Assign",
  //   icon: FileLockIcon,
  //   link: "siteassign",
  // },
  // {
  //   name: "Weekly Rota",
  //   icon: ScrollTextIcon,
  //   link: "weeklyrota",
  // },
  // {
  //   name: "Report",
  //   icon: GlobeLockIcon,
  //   link: "report",
  // },
  // {
  //   name: "Settings",
  //   icon: SettingsIcon,
  //   link: "settings",
  // },
];

export const reportMenu = [
  {
    name: "Dashboard",
    icon: HomeIcon,
    link: "overview",
  },
  {
    name: "Leave Report",
    icon: CalendarIcon,
    link: "leave",
  },
  {
    name: "Attendance Report",
    icon: TimerIcon,
    link: "attendance",
  },
  {
    name: "Expense Report",
    icon: ClipboardPlus,
    link: "expense",
  },
  {
    name: "Employee Report",
    icon: FileLockIcon,
    link: "employee",
  },
];

export const officeSlugComponentmap = {
  overview: EmployeeOtherDeatils,
  edit: EmployeeEdit,
  // timeoff: EmployeeTimeOff,
  // performance: EmployeePerformance,
  attendance: OfficeEmployeeAttendance,
  document: EmployeeFiles,
  // onboarding: EmployeeOnboarding,
  password: PasswordChange,
  session: SessionManagement,
  leave: EmployeeLeaveDeatails,
  weeklyrota: EmployeeWeeklyRota,
  bankholiday: () => <BankHoliday className={"xl:grid-cols-2"} />,
};

export const slugComponentmap = {
  overview: Overview,
  category: LeaveCategoryNew,
  request: LeaveRequestForm,
  entitlement: EmployeeLeaveEntitlement,
  requestoff: RequestOff,
  history: LeaveHistory,
  // addleaveEmployee: AddEmploeeLeave,
  holidaycalendar: HolidayPlannerCalendar,
  bankholiday: BankHoliday,
  report: LeaveReport,
  settings: CarryForwardSettings,
};

export const siteSlugComponentmap = {
  overview: EmployeeSiteManagement,
  scan: QRDialog,
  expense: SiteExpense,
};

export const siteOfficeEmployeSlugComponentmap = {
  overview: SiteEmployeeOtherDeatils,
  document: EmployeDocument,
};

export const reportSlugComponentmap = {
  overview: Overview,
  leave: LeaveReports,
  attendance: AttendanceReport,
};
