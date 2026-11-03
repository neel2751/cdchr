import { isValidObjectId } from "@/lib/mongodb";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/timeZone";
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
