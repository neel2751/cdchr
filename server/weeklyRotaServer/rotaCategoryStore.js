import AttendanceCategoryModel from "@/models/attendanceCategoryModel";
import { entryKind, starterRotaCategories } from "@/lib/rotaCategories";

/**
 * The starter rota categories (lib/rotaCategories.js), for a company that has
 * none of them yet. Only adds what is missing, by value, so running it twice —
 * or on a company that already made its own "Off" — changes nothing.
 *
 * NOT "use server": it writes to whichever company is in scope. Called from
 * company creation (tenantServer/companySetup.js) and from the rota screen's
 * own action (rotaCategoryServer.js), which checks who is asking.
 *
 * @param {object} terms the company's words
 * @param {{ tenantId?: any, session?: import("mongoose").ClientSession }} [o]
 */
export async function addStarterCategories(terms, { tenantId, session } = {}) {
  const starters = starterRotaCategories(terms);
  const existing = await AttendanceCategoryModel.find({
    attendanceCategoryValue: { $in: starters.map((s) => s.value) },
    isDeleted: false,
  })
    .session(session || null)
    .select("attendanceCategoryValue")
    .lean();
  const have = new Set(existing.map((c) => c.attendanceCategoryValue));
  const missing = starters
    .map((s, i) => ({ ...s, sortOrder: i }))
    .filter((s) => !have.has(s.value));
  if (!missing.length) return 0;
  await AttendanceCategoryModel.create(
    missing.map((s) => ({
      ...(tenantId ? { tenantId } : {}),
      attendanceCategoryName: s.name,
      attendanceCategoryValue: s.value,
      attendanceCategoryDescription: s.description,
      kind: s.kind,
      startTime: s.startTime,
      endTime: s.endTime,
      sortOrder: s.sortOrder,
      isActive: true,
      isDeleted: false,
    })),
    { session, ordered: true }
  );
  return missing.length;
}

/**
 * Write each rota day's category name and rule onto it, as they are now, so
 * the saved rota reads the same after a category is renamed or changed —
 * and the screens showing it need no list of categories to make sense of it.
 * Days whose category is unknown keep what they had.
 *
 * @param {Array<{ schedule?: object[] }>} attendanceData
 */
export async function stampRotaEntries(attendanceData) {
  if (!Array.isArray(attendanceData)) return attendanceData;
  const rows = await AttendanceCategoryModel.find({ isDeleted: false }).lean();
  const byValue = new Map(rows.map((c) => [c.attendanceCategoryValue, c]));
  return attendanceData.map((person) => ({
    ...person,
    schedule: Array.isArray(person?.schedule)
      ? person.schedule.map((day) => {
          const category = byValue.get(day?.category);
          if (!category) return { ...day, kind: entryKind(day) || undefined };
          const kind = entryKind(category);
          return {
            ...day,
            kind,
            label: category.attendanceCategoryName,
            // A day off has no hours and no place, whatever the form sent.
            ...(kind === "off" ? { startTime: "00:00", endTime: "00:00", site: undefined } : {}),
            ...(kind === "work" ? { site: undefined } : {}),
          };
        })
      : person?.schedule,
  }));
}
