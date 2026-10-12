/**
 * Which screens are actually being opened.
 *
 * The read-out for models/screenViewModel.js. Answers the question that could
 * not be answered when a ReferenceError sat in Filter Attendance for two days:
 * does anybody open this, and when did they last.
 *
 * Screens with no rows at all are listed separately, because "no views
 * recorded" is the interesting half — but read it against the start date it
 * prints: a screen can only look unused once logging has been running long
 * enough for somebody to have had a reason to open it.
 *
 * Read-only. It writes nothing and is safe against production.
 *
 *   node scripts/screen-usage.mjs
 *   node scripts/screen-usage.mjs --days 30
 *   node scripts/screen-usage.mjs --json
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const AS_JSON = process.argv.includes("--json");
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) || 90 : 90;

/**
 * The menu paths this deployment offers, so a screen with no views can be
 * named rather than merely absent. Read from the built menu rather than
 * hardcoded, with the commented-out entries therefore correctly missing.
 */
async function menuPaths() {
  try {
    const { MENU, COMMONMENUITEMS } = await import("../data/menu.js");
    return [...(MENU || []), ...(COMMONMENUITEMS || [])]
      .map((item) => item?.path)
      .filter(Boolean);
  } catch (error) {
    console.log("(could not read data/menu.js:", error?.message + ")");
    return [];
  }
}

function ago(date) {
  if (!date) return "never";
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const since = new Date(Date.now() - DAYS * 86400000);

  const rows = await db
    .collection("screenviews")
    .aggregate([
      { $match: { lastAt: { $gte: since } } },
      {
        $group: {
          _id: "$path",
          views: { $sum: "$count" },
          people: { $addToSet: "$employeeId" },
          roles: { $addToSet: "$role" },
          lastAt: { $max: "$lastAt" },
        },
      },
      { $sort: { lastAt: -1 } },
    ])
    .toArray();

  const earliest = await db
    .collection("screenviews")
    .find({}, { projection: { firstAt: 1 } })
    .sort({ firstAt: 1 })
    .limit(1)
    .toArray();

  const seen = new Map(rows.map((r) => [r._id, r]));
  const unseen = (await menuPaths()).filter((p) => !seen.has(p));

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          days: DAYS,
          loggingSince: earliest[0]?.firstAt ?? null,
          opened: rows.map((r) => ({
            path: r._id,
            views: r.views,
            people: r.people.length,
            roles: r.roles.filter(Boolean),
            lastAt: r.lastAt,
          })),
          noViewsRecorded: unseen,
        },
        null,
        2
      )
    );
    await mongoose.disconnect();
    return;
  }

  console.log(`Database: ${mongoose.connection.name}`);
  console.log(
    `Logging since: ${
      earliest[0]?.firstAt
        ? new Date(earliest[0].firstAt).toISOString().slice(0, 10)
        : "nothing recorded yet"
    }`
  );
  console.log(`Window: last ${DAYS} days\n`);

  if (!rows.length) {
    console.log("No screen views recorded in this window.");
  } else {
    console.log("OPENED");
    console.log(
      `  ${"screen".padEnd(38)}${"views".padStart(6)}${"people".padStart(8)}  last opened`
    );
    for (const r of rows) {
      console.log(
        `  ${String(r._id).padEnd(38)}${String(r.views).padStart(6)}${String(
          r.people.length
        ).padStart(8)}  ${ago(r.lastAt)}`
      );
    }
  }

  if (unseen.length) {
    console.log(`\nNO VIEWS RECORDED (${unseen.length} menu screens)`);
    for (const p of unseen) console.log(`  ${p}`);
    console.log(
      "\nJudge these against the start date above, not in the abstract."
    );
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
