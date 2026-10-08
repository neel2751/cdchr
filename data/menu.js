import { AlertTriangle, ShieldCheck } from "lucide-react";

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
  // Sits next to Office Staff because it is the same records seen from the
  // other side: what the people on that list say is wrong about them.
  {
    name: "Change Requests",
    path: "/admin/profileRequests",
    role: ["superAdmin", "admin"],
    icon: "ClipboardIcon",
  },
  {
    name: "Office Attendance",
    path: "/admin/attendance",
    role: ["superAdmin", "admin"], // admin, manager, user
    icon: "CalendarClock",
  },
  // Everything about clocking in: the scanner's rules, the places people scan
  // at, the tags they scan with, and the reports. These cards used to sit under
  // Leave Management -> Settings, which is where they ended up one at a time
  // rather than where anybody would look for them.
  //
  // SUPER ADMIN ONLY, and not as caution — as honesty. Every write behind these
  // cards already refuses anybody else: createClockLocation, setDefaultLocation,
  // updateWorkSettings, the tag actions and the ordering actions all check for
  // super admin themselves. Showing the page to an admin would show them
  // settings whose save button answers "Not authorized", which is worse than
  // not showing it at all.
  //
  // Named to match Company Settings and Email Settings, which is the family it
  // belongs to.
  {
    name: "Attendance Settings",
    path: "/admin/clockSettings",
    role: ["superAdmin"],
    icon: "ScanQrCode",
  },
  // Same gap the Expenses entry below describes: the page, the actions and the
  // device management had all existed for a while and nothing linked to them,
  // so only a super admin who already knew the URL could reach it. That is
  // where a reception screen is registered to an office — without it the
  // desk asks whoever is standing there which office it is in, and a wrong
  // answer files attendance at the other one.
  //
  // `/admin/reception` is already on the `reception` plan flag in
  // data/features.js, so proxy.js gates it for a company without the module.
  {
    name: "Reception Desk",
    path: "/admin/reception",
    role: ["superAdmin"],
    icon: "MonitorSmartphone",
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
  // This is where a site manager does a roll-call: it carries the clock
  // actions for site staff. It was superAdmin-only, which meant the one person
  // standing on the site could not clock their own team in — the capability
  // existed and the person who needed it could not reach it.
  //
  // `role` only decides who sees the link in the *superAdmin* sidebar; for
  // every other role the sidebar and proxy.js both go by granted permissions
  // (server/selectServer/selectServer.js#getEmployeeMenu). So widening this
  // makes the screen grantable and discoverable, and grants stay the control.
  // The server actions behind it are authorised separately — see
  // server/clockServer/clockAuth.js.
  {
    name: "Site Assignments",
    path: "/admin/siteAssignEmployee",
    role: ["superAdmin", "admin", "user"],
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
  // Bringing an existing staff list in from whatever the company used before
  // this one. Sits next to Company Settings because it belongs to setting the
  // company up rather than to running it — most companies use it once.
  //
  // Super admin only, and not only as caution. The import creates sign-in
  // credentials in bulk and can be aimed at either staff list, so the server
  // action behind it refuses anybody else as well (requireImporter in
  // server/migrationServer/migrationServer.js). Showing the page to an admin
  // would show them a screen whose Import button answers "Only a super admin
  // can import employee data".
  {
    name: "Import Staff Data",
    path: "/admin/migration",
    role: ["superAdmin"],
    icon: "FileUp",
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
    path: "/admin/me/attendance",
    role: ["user"],
    icon: "CalendarClock",
  },
  {
    name: "My Shifts",
    path: "/admin/me/shifts",
    role: ["user"],
    icon: "CalendarDays",
  },
  {
    name: "My Leave",
    path: "/admin/me/leave",
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
  // `hidden` entries are permission bypasses without a sidebar link. They exist
  // because proxy.js decides what an ordinary employee may open by looking at
  // this list, while the sidebar decides what to show from the same list — two
  // questions that usually have the same answer and here do not.
  //
  // /admin/me is the profile area, reached from the avatar menu rather than the
  // sidebar: it is looked at rarely, and a link to it alongside the daily items
  // would crowd them. One entry covers every tab under it.
  {
    name: "My Profile",
    path: "/admin/me",
    role: ["superAdmin", "admin", "user"],
    icon: "UserRound",
    hidden: true,
  },
  // The paths this area used to live at. Each is now a page that redirects, and
  // each needs to be reachable for that redirect to run — otherwise an old
  // bookmark lands on the dashboard with no explanation instead of on the page
  // the person asked for.
  {
    name: "My Attendance (moved)",
    path: "/admin/my-attendance",
    role: ["superAdmin", "admin", "user"],
    hidden: true,
  },
  {
    name: "My Weekly Shifts (moved)",
    path: "/admin/my-weekly-shifts",
    role: ["superAdmin", "admin", "user"],
    hidden: true,
  },
  {
    name: "My Leaves (moved)",
    path: "/admin/my-leaves",
    role: ["superAdmin", "admin", "user"],
    hidden: true,
  },
  {
    name: "Account (moved)",
    path: "/admin/account",
    role: ["superAdmin", "admin", "user"],
    hidden: true,
  },
];

// MENUOLD and PERSONAL_MENU were removed here. Both were exported but reachable
// only from commented-out code, and both restated live entries under different
// names and a different permission scheme (`permissionKey` — nothing reads it) —
// so anyone reading this file to work out what the sidebar shows had three
// competing answers to choose from.

/**
 * The "More" group at the bottom of the sidebar.
 *
 * `icon` is a component, not an element: this file is a data module, and JSX in
 * it meant the whole thing could only be parsed by the bundler — so anything
 * importing it (server/selectServer/selectServer.js, which builds every user's
 * menu) could not be loaded by a plain-node test. MENU above uses string names
 * resolved through an ICON_MAP for the same reason; these two were the only JSX
 * left. Rendered by components/sidebar/sideBarCom.jsx.
 */
export const REPORT = [
  {
    name: "Permission",
    path: "/admin/permissions",
    icon: ShieldCheck,
    role: ["superAdmin"],
  },
  {
    name: "Report Issue",
    path: "/admin/reportIssue",
    icon: AlertTriangle,
    role: ["superAdmin"],
  },
];

export function getReportMenu(path) {
  return REPORT.find((item) => item?.path === path);
}

export function getMenu(path) {
  return MENU.find((item) => item?.path === path);
}
