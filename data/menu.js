import { AlertTriangle, ShieldCheck } from "lucide-react";
import React from "react";

export const MENU = [
  // {
  //   name: "Dashboard",
  //   path: "/admin/dashboard",
  //   role: ["superAdmin"], // admin, manager, user
  //   icon: "LayoutDashboard",
  // },

  // {
  //   name: "Attendance",
  //   path: "/admin/employeeAttendance",
  //   role: ["user"],
  //   icon: "CalendarClock",
  // },
  // {
  //   name: "My Attendance",
  //   path: "/admin/my-attendance",
  //   role: ["user", "admin", "superAdmin"],
  //   icon: "ClockCheck",
  // },
  {
    name: "Leave Management",
    path: "/admin/leaveManagement",
    role: ["superAdmin", "admin"], // admin, manager, user
    icon: "Stamp",
  },
  // The two staff lists are different populations in different collections —
  // office employees sign into /admin, site employees into /employee. Naming
  // one "Office Management" and the other just "Employees" gave no hint that
  // they were a pair, or which one held whom.
  {
    name: "Office Staff",
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
    name: "Site Employees",
    path: "/admin/employee",
    role: ["superAdmin"],
    icon: "ClipboardIcon",
  },
  {
    name: "Project Sites",
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
  // Assigns an office employee to run a site. Named for what it manages rather
  // than the verb, so it cannot be confused with "Site Assignments" below —
  // "Assign Site Manager" and "Assign Site" sat next to each other and read as
  // the same thing.
  {
    name: "Site Managers",
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
  // Puts site employees on a site for a given day. The submenu that used to be
  // here pointed at /shiftview/viewshifts and /addEmpToShift, neither of which
  // is a route in this app — and the sidebar never rendered submenus anyway.
  {
    name: "Site Assignments",
    path: "/admin/siteAssignEmployee",
    role: ["superAdmin"],
    icon: "Network",
  },
  // The page, the server actions and the models have existed for a while, but
  // nothing ever linked to it — so only a super admin typing the URL could
  // reach it (proxy.js redirects everyone else when a path has no MENU entry).
  // Gated by the `expenses` plan flag, which lib/tenantPlan.js already mapped.
  {
    name: "Expenses",
    path: "/admin/expense",
    role: ["superAdmin", "admin"],
    icon: "Receipt",
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
    name: "Departments",
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

  // {
  //   name: "Visitor Management",
  //   path: "/admin/leads",
  //   role: ["superAdmin", "admin"],
  //   icon: "SquareChartGantt",
  // },

  // {
  //   name: "QR Code Management",
  //   path: "/admin/qr",
  //   role: ["superAdmin", "admin"],
  //   icon: "ScanQrCode",
  // },

  // {
  //   name: "Form Template",
  //   path: "/admin/templates",
  //   role: ["superAdmin", "admin"],
  //   icon: "FileText",
  // },
  {
    name: "Announcements",
    path: "/admin/announcements",
    role: ["superAdmin", "admin"],
    icon: "Megaphone",
  },
  {
    name: "Audit Logs",
    path: "/admin/auditLogs",
    role: ["superAdmin"],
    icon: "ScrollText",
  },
  {
    name: "Media Management",
    path: "/admin/document",
    role: ["superAdmin"],
    icon: "FolderOpen",
  },
  // Branding and custom domains for this company. Super admin only: it changes
  // what every user of the company sees, and which hostnames route to it.
  {
    name: "Company Settings",
    path: "/admin/settings",
    role: ["superAdmin"],
    icon: "Settings",
  },
  // The company's outgoing mail senders. Built but never linked, so it was
  // reachable only by a super admin typing the URL. Super admin only for the
  // same reason as Company Settings: it decides the identity every message the
  // app sends goes out under — password resets, visa reminders, announcements.
  {
    name: "Email Settings",
    path: "/admin/email",
    role: ["superAdmin"],
    icon: "Mail",
  },
  // Kept at the bottom: former/inactive staff listings. Access is derived from
  // the matching active page (see DERIVED_ACCESS) so admins who can see the
  // active list automatically get the "previous" list without a separate grant.
  {
    name: "Previous Office Staff",
    path: "/admin/previousOfficeEmployee",
    role: ["superAdmin", "admin"],
    icon: "Archive",
  },
  {
    name: "Previous Site Employees",
    path: "/admin/previousEmployee",
    role: ["superAdmin", "admin"],
    icon: "UserX",
  },
];

// Pages whose access mirrors a parent page's permission. An admin who can access
// the parent path automatically gets the derived path (used by the sidebar
// builder and the middleware route guard).
export const DERIVED_ACCESS = {
  "/admin/previousOfficeEmployee": "/admin/officeEmployee",
  "/admin/previousEmployee": "/admin/employee",
};

// Permission to read an employee's bank account details and National Insurance
// number. Stored on a role the same way menu paths are, but it is NOT a page —
// it never appears in the sidebar, it only unlocks the protected details panel
// (behind a password re-check).
export const SENSITIVE_DETAILS_PERMISSION = "SENSITIVE_DETAILS_VIEW";

// Capabilities are permissions that gate data rather than a route. They are
// offered alongside the menu paths when assigning a role's permissions.
export const CAPABILITIES = [
  {
    name: "View Bank & NI Details",
    path: SENSITIVE_DETAILS_PERMISSION,
    role: ["superAdmin", "admin"],
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
  // "/admin/siteAssign" used to sit here as "Assign Site ", which had two
  // consequences, both wrong. COMMONMENUITEMS entries are shown to every role by
  // the sidebar and waved past the permission check by proxy.js — so every
  // signed-in user saw a "Site Managers" link and could open the page whether or
  // not the permission had been granted. It also duplicated the MENU entry for
  // the same path under a second, different name, which is why the sidebar
  // appeared to have two "Assign Site" items. It now lives in MENU only.
  {
    name: "My Attendance",
    path: "/admin/my-attendance",
    role: ["user"],
    icon: "CalendarClock",
  },
  {
    name: "My Weekly Shifts",
    path: "/admin/my-weekly-shifts",
    role: ["user"],
    icon: "CalendarDays",
  },
  {
    name: "My Leaves",
    path: "/admin/my-leaves",
    role: ["user"],
    icon: "Stamp",
  },
  // Reading what was sent to you is not a privilege. Being in COMMONMENUITEMS
  // means the sidebar shows it to every role and proxy.js lets everyone past —
  // which is the point: an announcement nobody can open is not an announcement.
  {
    name: "My Announcements",
    path: "/admin/my-announcements",
    role: ["superAdmin", "admin", "user"],
    icon: "Megaphone",
  },
];

// MENUOLD and PERSONAL_MENU were removed here. Both were exported but reachable
// only from commented-out code, and both restated live entries under different
// names and a different permission scheme (`permissionKey` — nothing reads it) —
// so anyone reading this file to work out what the sidebar shows had three
// competing answers to choose from.

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
