"use server";

import { connect } from "@/db/db";
import { createObjectId } from "@/lib/mongodb";
import { getWorkingDate } from "@/lib/clockTime";
import { featureRefusal } from "@/lib/requireFeature";
import { getSiteScope } from "@/lib/siteAccess";
import { getTenantProfile } from "@/lib/tenantTerms";
import { blockOfField } from "@/data/fieldBlocks";
import { EMPLOYEFIELD } from "@/data/fields/fields";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import StandingAssignmentModel from "@/models/standingAssignmentModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import ClockRecordModel from "@/models/clockInModel";

/**
 * A place manager's own page: the places they run, who belongs to each, who
 * is in today, and the notes that keep people safe.
 *
 * What it shows is deliberately narrow. A class teacher needs a headcount,
 * who has arrived and who has a nut allergy; they do not need every parent's
 * mobile number. So:
 *
 *   - medical notes appear when the company uses the medical block
 *     (data/fieldBlocks.js) — safety information is the point of the page;
 *   - phone numbers, emails and guardian contacts appear only when the company
 *     lets managers see them (Settings → Form), or to someone who administers
 *     sites company-wide and can see them elsewhere anyway.
 *
 * Which places: the ones the caller manages today (lib/siteAccess.js), or
 * every active place for somebody who administers sites company-wide.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 14;

function nameOf(person) {
  if (!person) return "Unknown";
  return (
    person.name ||
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    "Unnamed"
  );
}

export async function getMySites() {
  try {
    const refusal = await featureRefusal("siteProjects");
    if (refusal) return refusal;

    const scope = await getSiteScope();
    if (!scope) return { success: false, message: "Not signed in" };
    if (scope.selfOnly || scope.readOnly) {
      return { success: false, message: "You do not have access to this" };
    }

    await connect();
    const profile = await getTenantProfile(scope.user.tenantId);
    const { blocks, managerRules } = profile;

    const sites = await ProjectSiteModel.find(
      scope.all
        ? { siteDelete: { $ne: true }, isActive: true }
        : { _id: { $in: scope.siteIds.map((id) => createObjectId(id)) } }
    )
      .select("siteName siteAddress")
      .sort({ siteName: 1 })
      .lean();
    const siteIds = sites.map((s) => s._id);

    const showContacts = scope.all || managerRules.seeContacts === true;
    const showMedical = blocks.medical !== false;
    // Counted by role on a building site, by year in a tuition centre — but
    // only if the company's form actually asks for that field.
    const field = profile.breakdownField;
    const fieldBlock = blockOfField(field);
    const breakdownField =
      field && (!fieldBlock || blocks[fieldBlock] !== false) ? field : null;
    const breakdownLabel = breakdownField
      ? EMPLOYEFIELD.find((f) => f.name === breakdownField)?.labelText || breakdownField
      : null;

    const today = getWorkingDate();
    const since = new Date(today.getTime() - RECENT_DAYS * DAY_MS);
    const weekday = today.getUTCDay();

    const [daily, current, joined, left] = await Promise.all([
      SiteAssignmentModel.find({ assignDate: today, siteId: { $in: siteIds } }).lean(),
      // On the place's books now: started, not ended, any weekday.
      StandingAssignmentModel.find({
        siteId: { $in: siteIds },
        isDeleted: { $ne: true },
        startDate: { $lte: today },
        $or: [{ endDate: null }, { endDate: { $gte: today } }],
      }).lean(),
      StandingAssignmentModel.find({
        siteId: { $in: siteIds },
        isDeleted: { $ne: true },
        startDate: { $gte: since, $lte: today },
      }).lean(),
      StandingAssignmentModel.find({
        siteId: { $in: siteIds },
        isDeleted: { $ne: true },
        endDate: { $gte: since, $lt: today },
      }).lean(),
    ]);

    const ids = [
      ...new Set([
        ...daily.flatMap((d) => d.assignedEmployees.map((a) => String(a.employeeId))),
        ...current.map((c) => String(c.employeeId)),
        ...joined.map((c) => String(c.employeeId)),
        ...left.map((c) => String(c.employeeId)),
      ]),
    ].map((id) => createObjectId(id));

    const siteFields = [
      "firstName",
      "lastName",
      ...(breakdownField ? [breakdownField] : []),
      ...(showMedical ? ["medicalNotes"] : []),
      ...(showContacts
        ? ["phone", "email", "guardianName", "guardianRelation", "guardianPhone", "guardianEmail"]
        : []),
    ].join(" ");
    const officeFields = ["name", ...(showContacts ? ["phoneNumber", "email"] : [])].join(" ");

    const [siteStaff, officeStaff, clocks] = await Promise.all([
      EmployeModel.find({ _id: { $in: ids } }).select(siteFields).lean(),
      OfficeEmployeeModel.find({ _id: { $in: ids } }).select(officeFields).lean(),
      ClockRecordModel.find({
        date: today,
        isDeleted: { $ne: true },
        employeeId: { $in: ids },
        siteId: { $in: siteIds },
      })
        .select("employeeId siteId clockIn clockOut")
        .lean(),
    ]);
    const people = Object.fromEntries(
      [...siteStaff, ...officeStaff].map((p) => [String(p._id), p])
    );
    const clockOf = Object.fromEntries(
      clocks.map((c) => [`${c.siteId}:${c.employeeId}`, c])
    );

    const result = sites.map((site) => {
      const sid = String(site._id);
      // Everyone on this place's books today: today's assignment, or an
      // ongoing one. `expected` is whether today is one of their days.
      const members = new Map();
      for (const d of daily.filter((d) => String(d.siteId) === sid)) {
        for (const a of d.assignedEmployees) {
          members.set(String(a.employeeId), { expected: true, ongoing: false });
        }
      }
      for (const c of current.filter((c) => String(c.siteId) === sid)) {
        const eid = String(c.employeeId);
        const onToday = !c.days?.length || c.days.includes(weekday);
        const prev = members.get(eid);
        members.set(eid, {
          expected: Boolean(prev?.expected) || onToday,
          ongoing: true,
        });
      }

      const rows = [...members.entries()].map(([eid, m]) => {
        const p = people[eid];
        const clock = clockOf[`${sid}:${eid}`];
        const status = clock?.clockIn
          ? clock.clockOut
            ? "Left"
            : "In"
          : m.expected
            ? "Not arrived"
            : "Not due today";
        return {
          employeeId: eid,
          name: nameOf(p),
          group: breakdownField ? p?.[breakdownField] || "Not set" : null,
          ongoing: m.ongoing,
          expected: m.expected,
          status,
          clockIn: clock?.clockIn || null,
          clockOut: clock?.clockOut || null,
          medicalNotes: showMedical ? p?.medicalNotes || "" : undefined,
          contacts: showContacts
            ? {
                phone: p?.phone || p?.phoneNumber || "",
                email: p?.email || "",
                guardianName: p?.guardianName || "",
                guardianRelation: p?.guardianRelation || "",
                guardianPhone: p?.guardianPhone || "",
                guardianEmail: p?.guardianEmail || "",
              }
            : undefined,
        };
      });
      rows.sort((a, b) => a.name.localeCompare(b.name));

      const breakdown = breakdownField
        ? Object.entries(
            rows.reduce((acc, r) => {
              acc[r.group] = (acc[r.group] || 0) + 1;
              return acc;
            }, {})
          )
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
        : [];

      const recent = (list, dateKey) =>
        list
          .filter((r) => String(r.siteId) === sid)
          .map((r) => ({
            name: nameOf(people[String(r.employeeId)]),
            date: r[dateKey],
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        siteId: sid,
        siteName: site.siteName,
        siteAddress: site.siteAddress || "",
        headcount: rows.length,
        expectedToday: rows.filter((r) => r.expected).length,
        inNow: rows.filter((r) => r.status === "In").length,
        arrivedToday: rows.filter((r) => r.clockIn).length,
        withMedicalNotes: showMedical
          ? rows.filter((r) => r.medicalNotes).length
          : 0,
        breakdown,
        people: rows,
        joined: recent(joined, "startDate"),
        left: recent(left, "endDate"),
      };
    });

    return {
      success: true,
      data: JSON.stringify({
        today,
        sites: result,
        showContacts,
        showMedical,
        breakdownLabel,
      }),
    };
  } catch (error) {
    console.log("getMySites error:", error?.message);
    return { success: false, message: "Could not load your places" };
  }
}

/**
 * Whether the caller may put people on, move or end them on the places they
 * manage — so the board can hide buttons the server would refuse. The server
 * actions check again (assignRefusal); this only decides what is offered.
 */
export async function getMySiteRights() {
  const scope = await getSiteScope();
  if (!scope) return { success: false, message: "Not signed in" };
  const canAssign =
    scope.all
      ? !scope.readOnly
      : !scope.selfOnly && !scope.readOnly && scope.canAssign !== false;
  return { success: true, data: JSON.stringify({ canAssign }) };
}
