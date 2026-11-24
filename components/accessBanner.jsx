import { Clock, Lock, TriangleAlert } from "lucide-react";

/**
 * The company's trial or lock, across the top of every page
 * (lib/tenantAccess.js). The wording comes from the server — see accessNotice
 * in server/tenantServer/myCompanyAccess.js — so this only decides colour.
 *
 * No hooks, so the admin shell (a client component) and the employee and
 * reception layouts (server components) can all render it.
 */
const TONES = {
  info: "bg-sky-50 text-sky-950 border-sky-200 dark:bg-sky-950/40 dark:text-sky-100 dark:border-sky-900",
  warning:
    "bg-amber-50 text-amber-950 border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900",
  danger:
    "bg-red-50 text-red-950 border-red-200 dark:bg-red-950/40 dark:text-red-100 dark:border-red-900",
};

export default function AccessBanner({ notice, contactEmail }) {
  if (!notice?.text) return null;
  const Icon =
    notice.tone === "info" ? Clock : notice.tone === "warning" ? TriangleAlert : Lock;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm ${
        TONES[notice.tone] || TONES.info
      }`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{notice.text}</span>
      {notice.action?.href && (
        <a
          href={notice.action.href}
          className="font-medium underline underline-offset-2"
        >
          {notice.action.label}
        </a>
      )}
      {!notice.action && notice.owner && notice.tone !== "info" && contactEmail && (
        <a
          href={`mailto:${contactEmail}?subject=${encodeURIComponent("Choosing a plan")}`}
          className="font-medium underline underline-offset-2"
        >
          Contact us
        </a>
      )}
    </div>
  );
}
