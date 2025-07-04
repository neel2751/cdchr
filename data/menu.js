import { AlertTriangle, ShieldCheck } from "lucide-react";
import React from "react";

export const MENU = [
  // {
  //   name: "Dashboard",
  //   path: "/admin/dashboard",
  //   role: ["superAdmin"], // admin, manager, user
  //   icon: "LayoutDashboard",
  // },
  {
    name: "Leave Management",
    path: "/admin/leaveManagement",
    role: ["superAdmin", "admin"], // admin, manager, user
    icon: "Stamp",
  },
  {
    name: "Office Management",
    path: "/admin/officeEmployee",
    role: ["superAdmin", "admin"], // admin, manager, user
    icon: "Briefcase",
  },
  {
    name: "Office Attendance",
    path: "/admin/attendance",
    role: ["superAdmin", "admin"], // admin, manager, user
    icon: "CalendarClock",
  },
  // {
  //   name: "Leave Management",
  //   path: "/admin/leave",
  //   role: ["superAdmin", "admin"], // admin, manager, user
  //   icon: "Stamp",
  // },
  {
    name: "Weekly Rota",
    path: "/admin/weeklyRota",
    role: ["superAdmin", "admin"], // admin, manager, user
    icon: "CalendarDays",
  },
  {
    name: "Employees",
    path: "/admin/employee",
    role: ["superAdmin"],
    icon: "ClipboardIcon",
  },
  {
    name: "Site Project",
    path: "/admin/siteProject",
    role: ["superAdmin"],
    icon: "NewspaperIcon",
  },

  // {
  //   name: "Attendance",
  //   path: "/Admin/Attendance",
  //   role: ["superAdmin"],
  //   icon: <CalendarDaysIcon className="w-5 h-5" />,
  // },
  {
    name: "Filter Attendance",
    path: "/admin/filterAttendance",
    role: ["superAdmin", "admin", "user"],
    icon: "Filter",
  },
  {
    name: "Assign Site Manager ",
    path: "/admin/siteAssign",
    role: ["superAdmin", "admin", "user"],
    icon: "RadioIcon",
  },

  // {
  //   name: "RoleTypes",
  //   path: "/admin/roleType",
  //   role: ["superAdmin"],
  //   icon: <ChartPieIcon className="w-5 h-5" />,
  // },
  {
    name: "Assign Site",
    // path: "/admin/assignSite",
    path: "/admin/siteAssignEmployee",
    role: ["superAdmin"],
    submenu: [
      { name: "View Shifts", path: "/shiftview/viewshifts" },
      { name: "Add Employee to Shift", path: "/addEmpToShift" },
    ],
    icon: "Network",
  },

  // {
  //   name: "Marketing",
  //   path: "/admin/marketing",
  //   role: ["superAdmin"],
  //   icon: <MegaphoneIcon className="w-5 h-5" />,
  // },
  // {
  //   name: "File Manager",
  //   path: "/admin/fileShare",
  //   role: ["superAdmin"],
  //   icon: <FolderOpen className="h-5 w-5" />,
  // },
  {
    name: "Department",
    path: "/admin/roleType",
    role: ["superAdmin"],
    icon: "Captions",
  },
  {
    name: "Company",
    path: "/admin/company",
    role: ["superAdmin", "admin"],
    icon: "Building2",
  },
];

export const COMMONMENUITEMS = [
  {
    name: "Dashboard",
    path: "/admin/dashboard",
    role: ["superAdmin"], // admin, manager, user
    icon: "LayoutDashboard",
  },
  // {
  //   name: "Leave Management",
  //   path: "/admin/leaveManagement",
  //   role: ["superAdmin", "admin"], // admin, manager, user
  //   icon: "Stamp",
  // },
  {
    name: "Assign Site ",
    path: "/admin/siteAssign",
    role: ["superAdmin", "admin", "user"],
    icon: "RadioIcon",
  },
];

export const REPORT = [
  {
    name: "Permission",
    path: "/admin/permissions",
    icon: <ShieldCheck className="w-5 h-5" />,
    role: ["superAdmin"],
  },
  {
    name: "Report Issue",
    path: "/admin/reportIssue",
    icon: <AlertTriangle className="w-5 h-5" />,
    role: ["superAdmin"],
  },
];

export function getReportMenu(path) {
  return REPORT.find((item) => item?.path === path);
}

export function getMenu(path) {
  return MENU.find((item) => item?.path === path);
}
