import { FileLockIcon, LockIcon, UserRoundIcon } from "lucide-react";

/**
 * The tabs of the self-service profile area.
 *
 * Deliberately NOT `officeMenu` from app/admin/_components/menu.js, even though
 * this area started as a copy of the employee detail page: that menu is shared
 * with /admin/officeEmployee/<id>, so editing it to suit this page would change
 * what HR sees. Two pages with different jobs get two menus.
 *
 * What is missing from here is the point. Attendance, shifts and leave are in
 * the sidebar, where somebody who looks at them every day can reach them in one
 * click instead of through a profile page. Bank holidays are a company
 * calendar, not a personal setting, so they belong with leave and the rota
 * rather than here. Edit is gone entirely — an employee's own record is read
 * with a way to ask for corrections, not a form.
 */
export const SELF_TABS = [
  { name: "Profile", link: "profile", icon: UserRoundIcon },
  { name: "Documents", link: "documents", icon: FileLockIcon },
  { name: "Security", link: "security", icon: LockIcon },
];

export const SELF_BASE_PATH = "/admin/me";
