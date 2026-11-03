import { isValidObjectId } from "@/lib/mongodb";
import {
  DEFAULT_TIME_ZONE,
  getZonedNow,
  isValidTimeZone,
} from "@/lib/timeZone";
import ProjectSiteModel from "@/models/siteProjectModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import CompanyModel from "@/models/companyModel";

/**
 * The zone a clock event is recorded in.
 *
 * The site decides first: someone clocking in on a site in Dhaka is on Dhaka
 * time whoever employs them, and site workers have no company to fall back
 * on. Office staff, and anyone on a site with no zone set, follow their
 * company. Everything else is UK time.
 */
export async function resolveTimeZone({ siteId = null, employeeId = null }) {
  if (siteId && isValidObjectId(siteId)) {
    const site = await ProjectSiteModel.findById(siteId)
      .select("timeZone")
      .lean();
    if (isValidTimeZone(site?.timeZone)) return site.timeZone;
  }

  if (employeeId && isValidObjectId(employeeId)) {
    const employee = await OfficeEmployeeModel.findById(employeeId)
      .select("company")
      .lean();
    if (employee?.company) {
      const company = await CompanyModel.findById(employee.company)
        .select("timeZone")
        .lean();
      if (isValidTimeZone(company?.timeZone)) return company.timeZone;
    }
  }

  return DEFAULT_TIME_ZONE;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Today where this employee works, as UTC midnight — the shape clock records'
 * `date` and site assignments' `assignDate` are stored in. The server's own
 * date is the UK's at best, and a Dhaka worker's day starts six hours sooner.
 */
export async function todayFor({ siteId = null, employeeId = null }) {
  const zone = await resolveTimeZone({ siteId, employeeId });
  return new Date(getZonedNow(zone).date);
}

/**
 * Aggregation expression for today's date in whatever zone `zoneExpr`
 * evaluates to, as UTC midnight. It lets a board of people in different
 * places give each row its own today. An unset zone is UK time, like a
 * record from before zones existed.
 */
export function localTodayExpr(zoneExpr, now = new Date()) {
  const zone = { $ifNull: [zoneExpr, ""] };
  return {
    $dateFromString: {
      dateString: {
        $dateToString: {
          date: now,
          format: "%Y-%m-%d",
          timezone: { $cond: [{ $eq: [zone, ""] }, DEFAULT_TIME_ZONE, zone] },
        },
      },
      format: "%Y-%m-%d",
    },
  };
}

/**
 * The dates any zone's today can be: no inhabited zone is more than a day
 * from UTC. A plain range on an indexed date, to narrow a query before the
 * per-row `localTodayExpr` check.
 */
export function aroundToday(now = new Date()) {
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return {
    $gte: new Date(utcMidnight - DAY_MS),
    $lte: new Date(utcMidnight + DAY_MS),
  };
}
