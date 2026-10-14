/**
 * Switch one of a location's presence checks between shadow and enforce.
 *
 * `shadow` records a verdict and refuses nothing; `enforce` turns the verdict
 * into a decision (lib/locationPolicy.js). That is a one-field change with a
 * consequence the field does not look like it has, which is why it gets a
 * script with a dry run rather than a mongo one-liner: a radius set too tight,
 * or coordinates captured in the wrong place, does not produce a warning — it
 * produces somebody outside a door at 7am who cannot start work.
 *
 * WHAT THE DRY RUN TELLS YOU, and why it is worth reading before --apply:
 *
 *   The stored coordinates and radius, so a number nobody has looked at since
 *   it was saved gets looked at once more.
 *
 *   How much evidence shadow mode has actually gathered. This is the one that
 *   matters. Shadow mode is only a rehearsal if taps were recorded during it;
 *   zero measurements means enforcing a fence that has never been tested, and
 *   the script says so rather than letting the mode change imply otherwise.
 *
 *   Which methods would be enforcing afterwards. Under `requireAll: false` any
 *   one enforced method passing is enough, so adding a second enforced method
 *   can make the first toothless — an `nfc` check passes on the strength of the
 *   tap itself, which would wave through the very taps a geofence is there to
 *   question.
 *
 * Read-only unless --apply is given.
 *
 *   node --env-file=.env --import ./scripts/lib/action-loader.mjs \
 *     scripts/set-location-method-mode.mjs \
 *     --location <id> --method geofence --mode enforce [--apply]
 */
import mongoose from "mongoose";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const APPLY = argv.includes("--apply");

const LOCATION_ID = flag("location");
const METHOD = flag("method");
const MODE = flag("mode");
const STRICT_TAPS = flag("strict-taps");
const DB_NAME = flag("db", "test");

const VALID_MODES = ["off", "shadow", "enforce"];

function die(message) {
  console.error(message);
  process.exit(1);
}

if (!LOCATION_ID || !mongoose.Types.ObjectId.isValid(LOCATION_ID)) {
  die("Pass --location <objectid>");
}
if (STRICT_TAPS !== null) {
  if (!["on", "off"].includes(STRICT_TAPS)) die("Pass --strict-taps <on|off>");
} else {
  if (!METHOD) die("Pass --method <geofence|network|deviceQr|nfc|rollCall>");
  if (!VALID_MODES.includes(MODE)) die(`Pass --mode <${VALID_MODES.join("|")}>`);
}

async function main() {
  await mongoose.connect(process.env.MONGO_DB_URL, {
    dbName: DB_NAME,
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const _id = new mongoose.Types.ObjectId(LOCATION_ID);

  const location = await db.collection("clocklocations").findOne({ _id });
  if (!location) die(`No location ${LOCATION_ID} in "${DB_NAME}"`);

  const company = await db
    .collection("companies")
    .findOne({ _id: location.tenantId });

  const methods = Array.isArray(location.methods) ? location.methods : [];
  const existing = methods.find((m) => m?.type === METHOD);

  console.log(`${location.name} — ${company?.name || "unknown company"}`);
  console.log(`  location  ${location._id}`);
  console.log(`  requireAll ${location.requireAll === true}`);
  console.log();

  // --- must a tap say where it is? ----------------------------------------
  //
  // Its own mode, because it is not a method — it changes how one verdict is
  // read, and the thing it defends against is a FORWARDED link rather than a
  // replayed one. See models/clockLocationModel.js.
  if (STRICT_TAPS !== null) {
    const want = STRICT_TAPS === "on";
    const geofence = methods.find((m) => m?.type === "geofence");

    console.log(`  position required for taps: ${location.requirePositionForTaps === true} -> ${want}`);
    if (want && geofence?.mode !== "enforce") {
      die(
        `\n  This does nothing unless the geofence is enforced — it turns a\n` +
          `  MISSING position into a refusal, and a geofence on ${geofence?.mode || "no mode"}\n` +
          `  refuses nothing either way. Enforce the geofence first.`,
      );
    }
    if (want) {
      console.log();
      console.log(
        `  WHAT THIS WILL REFUSE: a tap from a phone that shares no position.\n` +
          `  That is the forwarded-link case — someone taps here, sends the link\n` +
          `  on, and the recipient declines the location prompt. It is ALSO an\n` +
          `  employee standing at the door who has denied location access to the\n` +
          `  site, or whose phone gets no fix indoors. They are not stranded (the\n` +
          `  QR code at reception and a manager's override both still work) but\n` +
          `  they will not know that unless somebody tells them.`,
      );
    }
    console.log();

    if (!APPLY) {
      console.log("Dry run. Nothing was changed. Re-run with --apply.");
      await mongoose.disconnect();
      return;
    }

    await db.collection("clocklocations").updateOne(
      { _id },
      { $set: { requirePositionForTaps: want, updatedAt: new Date() } },
    );
    await db.collection("auditlogs").insertOne({
      actorType: "System",
      actorName: "System",
      actorRole: "system",
      action: "ClockLocation.setStrictTaps",
      module: "Clock",
      entityId: _id,
      tenantId: location.tenantId ?? undefined,
      description:
        `A tag tap at ${location.name} ${want ? "now requires" : "no longer requires"} ` +
        `a position. ${want ? "A forwarded tap link can no longer be used by declining the location prompt." : "A tap with no position is allowed again."}`,
      before: { requirePositionForTaps: location.requirePositionForTaps === true },
      after: { requirePositionForTaps: want },
      status: "success",
      createdAt: new Date(),
    });

    console.log(`Applied. Taps at ${location.name} ${want ? "must" : "need not"} report a position.`);
    await mongoose.disconnect();
    return;
  }

  // --- what is actually configured ----------------------------------------
  if (METHOD === "geofence") {
    const f = location.geofence || {};
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) {
      die(
        "  This location has no geofence coordinates, so enforcing one would " +
          "refuse nothing and mean nothing. Set the centre first.",
      );
    }
    console.log(`  centre    ${f.lat}, ${f.lng}`);
    console.log(`  radius    ${Number(f.radiusMetres) || 150}m`);
    console.log(`  map       https://www.google.com/maps?q=${f.lat},${f.lng}`);
    console.log();
  }
  if (METHOD === "network") {
    console.log(`  networks  ${JSON.stringify(location.networks || [])}`);
    console.log();
  }

  // --- how much did shadow mode actually measure? --------------------------
  //
  // The question the mode change rests on. A rehearsal nobody attended is not
  // a rehearsal.
  const measured = await db.collection("clockrecords").countDocuments({
    locationId: _id,
    "evidence.checks": { $elemMatch: { method: METHOD } },
  });
  const failed = await db.collection("clockrecords").countDocuments({
    locationId: _id,
    "evidence.checks": { $elemMatch: { method: METHOD, verdict: "fail" } },
  });
  const unknown = await db.collection("clockrecords").countDocuments({
    locationId: _id,
    "evidence.checks": { $elemMatch: { method: METHOD, verdict: "unknown" } },
  });

  console.log(`  shadow evidence for "${METHOD}" at this location:`);
  console.log(`    taps measured   ${measured}`);
  console.log(`    would have failed ${failed}`);
  console.log(`    unanswerable      ${unknown}  (no position / no address)`);
  if (measured === 0) {
    console.log();
    console.log(
      `    NOTHING HAS BEEN MEASURED. Enforcing now enforces a setting that\n` +
        `    no real tap has ever been checked against. It fails open where the\n` +
        `    evidence is missing entirely — a device that shares no position is\n` +
        `    allowed through — so the people it can refuse are exactly the ones\n` +
        `    who do share a position. If the stored centre is wrong, they are\n` +
        `    staff standing at the door.`,
    );
  } else if (failed > 0) {
    const pct = Math.round((failed / measured) * 100);
    console.log();
    console.log(
      `    ${pct}% of measured taps would have been REFUSED. Check the radius\n` +
        `    and the centre before enforcing; that is the rehearsal telling you\n` +
        `    something.`,
    );
  }
  console.log();

  // --- what would be enforcing afterwards ----------------------------------
  const after = existing
    ? methods.map((m) => (m.type === METHOD ? { ...m, mode: MODE } : m))
    : [...methods, { type: METHOD, mode: MODE }];
  const enforcing = after.filter((m) => m.mode === "enforce").map((m) => m.type);

  console.log(`  ${METHOD}: ${existing?.mode || "(not configured)"} -> ${MODE}`);
  console.log(`  enforcing afterwards: ${enforcing.length ? enforcing.join(", ") : "nothing"}`);
  if (enforcing.length > 1 && location.requireAll !== true) {
    console.log();
    console.log(
      `    MORE THAN ONE ENFORCED METHOD WITH requireAll: false. Any single one\n` +
        `    passing is enough, so these do not add up — the most permissive of\n` +
        `    them decides. Set requireAll if they are all meant to hold.`,
    );
  }
  console.log();

  if (!APPLY) {
    console.log("Dry run. Nothing was changed. Re-run with --apply.");
    await mongoose.disconnect();
    return;
  }

  // Positional update on the matched element, so a concurrent edit to another
  // method is not overwritten by writing the whole array back.
  const result = existing
    ? await db.collection("clocklocations").updateOne(
        { _id, "methods.type": METHOD },
        { $set: { "methods.$.mode": MODE, updatedAt: new Date() } },
      )
    : await db.collection("clocklocations").updateOne(
        { _id },
        {
          $push: { methods: { type: METHOD, mode: MODE } },
          $set: { updatedAt: new Date() },
        },
      );

  if (!result.modifiedCount) die("Nothing was modified — re-run the dry run.");

  await db.collection("auditlogs").insertOne({
    actorType: "System",
    actorName: "System",
    actorRole: "system",
    action: "ClockLocation.setMethodMode",
    module: "Clock",
    entityId: _id,
    tenantId: location.tenantId ?? undefined,
    description:
      `"${METHOD}" at ${location.name} changed from ` +
      `${existing?.mode || "not configured"} to ${MODE} from the command line` +
      (measured === 0 ? " with no shadow measurements on record" : ""),
    before: { method: METHOD, mode: existing?.mode ?? null },
    after: {
      method: METHOD,
      mode: MODE,
      enforcing,
      requireAll: location.requireAll === true,
      shadowTapsMeasured: measured,
    },
    status: "success",
    createdAt: new Date(),
  });

  console.log(`Applied. "${METHOD}" at ${location.name} is now ${MODE}.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
