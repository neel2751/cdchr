/**
 * Why there is no position, and whether we can tell.
 *
 * This covers the one thing the module exists for: a missing position used to
 * be a single `null` standing in for five causes with five different fixes,
 * and the day two phones behaved differently there was nothing recorded
 * anywhere that could tell them apart. The classification below is what
 * replaced that, so it is worth testing properly — a reason reported wrongly
 * is worse than no reason, because somebody will act on it.
 *
 * The browser is faked. There is no navigator in node, which is the point:
 * these are the exact shapes WebKit produces, written down where they can be
 * checked, instead of being discovered on somebody's phone at a cabin door.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-clock-evidence.mjs
 */
import assert from "node:assert";

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/**
 * A navigator whose geolocation does whatever the test needs.
 *
 * defineProperty rather than assignment: node has its own `navigator` global
 * and it is a getter, so `globalThis.navigator = …` throws.
 */
function fakeNavigator(behaviour, { permissions } = {}) {
  const calls = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      geolocation: behaviour
        ? {
            getCurrentPosition(onOk, onErr, options) {
              calls.push(options);
              behaviour(onOk, onErr);
            },
          }
        : undefined,
      permissions,
    },
  });
  return calls;
}

/** The error object the spec defines and WebKit actually sends. */
const geoError = (code, message = "") => ({ code, message });

async function main() {
  const {
    requestPosition,
    getPosition,
    permissionState,
    collectClockEvidence,
    POSITION_ERROR,
    POSITION_ERROR_TEXT,
  } = await import("@/lib/clockEvidence");

  // ─── the happy path ───────────────────────────────────────────────────────
  await check("a fix comes back as coordinates, with accuracy rounded", async () => {
    fakeNavigator((onOk) =>
      onOk({ coords: { latitude: 51.5777, longitude: 0.0692, accuracy: 12.4871 } }),
    );
    const res = await requestPosition();
    assert.equal(res.error, null);
    assert.equal(res.coords.lat, 51.5777);
    assert.equal(res.coords.accuracyMetres, 12, "a sub-metre figure implies precision GPS does not have");
  });

  await check("getPosition keeps its old contract: coordinates, or null", async () => {
    // The admin screen's "use my current position" button depends on this
    // shape. Changing it under that button would break a working screen in
    // order to improve a different one.
    fakeNavigator((onOk) =>
      onOk({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }),
    );
    assert.deepEqual(await getPosition(), { lat: 1, lng: 2, accuracyMetres: 5 });

    fakeNavigator((onOk, onErr) => onErr(geoError(1)));
    assert.equal(await getPosition(), null);
  });

  // ─── THE DISTINCTION THIS WAS ALL FOR ─────────────────────────────────────
  await check(
    "an instant refusal is reported as never having asked",
    async () => {
      // iOS with Location Services off for the browser refuses immediately and
      // shows nothing. The employee is telling the truth when they say they
      // were never asked, and the fix is in their phone's Settings — not a
      // conversation about whether they declined.
      fakeNavigator((onOk, onErr) => onErr(geoError(1, "User denied Geolocation")));
      const res = await requestPosition();
      assert.equal(res.error, POSITION_ERROR.DENIED_NO_PROMPT);
    },
  );

  await check("a refusal somebody had time to read is reported as declined", async () => {
    fakeNavigator((onOk, onErr) =>
      setTimeout(() => onErr(geoError(1, "User denied Geolocation")), 400),
    );
    const res = await requestPosition();
    assert.equal(res.error, POSITION_ERROR.DENIED);
    assert.ok(res.afterMs >= 250, `afterMs was ${res.afterMs}`);
  });

  await check(
    "our own Permissions-Policy is never reported as somebody's choice",
    async () => {
      // This one is ours to fix. It arrives as PERMISSION_DENIED, instantly,
      // and blaming the employee's phone for a header on our server is how a
      // misconfiguration survives for months. It already did once: geolocation
      // was absent from the policy and every coordinate was silently null.
      fakeNavigator((onOk, onErr) =>
        onErr(geoError(1, "Geolocation has been disabled by permissions policy")),
      );
      const res = await requestPosition();
      assert.equal(res.error, POSITION_ERROR.BLOCKED);
    },
  );

  await check("an insecure context is blocked, not declined", async () => {
    fakeNavigator((onOk, onErr) =>
      onErr(geoError(1, "Origin does not have permission to use Geolocation: insecure")),
    );
    assert.equal((await requestPosition()).error, POSITION_ERROR.BLOCKED);
  });

  await check("a browser with no geolocation at all is blocked", async () => {
    fakeNavigator(null);
    assert.equal((await requestPosition()).error, POSITION_ERROR.BLOCKED);
  });

  await check("the other two codes keep their own names", async () => {
    fakeNavigator((onOk, onErr) => onErr(geoError(3, "Timeout expired")));
    assert.equal((await requestPosition()).error, POSITION_ERROR.TIMEOUT);

    fakeNavigator((onOk, onErr) => onErr(geoError(2, "Position unavailable")));
    assert.equal((await requestPosition()).error, POSITION_ERROR.UNAVAILABLE);
  });

  await check("every reason has something to show a human", async () => {
    for (const reason of Object.values(POSITION_ERROR)) {
      assert.ok(
        POSITION_ERROR_TEXT[reason],
        `${reason} would render as an empty amber box`,
      );
    }
  });

  // ─── the timeout that was racing the person, not the GPS ──────────────────
  await check("a first request waits for a human, not for a chip", async () => {
    // Eight seconds is right for a cold fix and wrong for a permission sheet:
    // it was being spent waiting for somebody to notice a prompt, read it and
    // press Allow, and the prompt usually won — which recorded "no position"
    // and, under requirePositionForTaps, now refuses the tap.
    const quick = fakeNavigator((onOk) =>
      onOk({ coords: { latitude: 1, longitude: 2, accuracy: 1 } }),
    );
    await requestPosition();
    assert.equal(quick[0].timeout, 8000);

    const first = fakeNavigator((onOk) =>
      onOk({ coords: { latitude: 1, longitude: 2, accuracy: 1 } }),
    );
    await requestPosition({ firstRequest: true });
    assert.ok(
      first[0].timeout >= 20000,
      `a first prompt only got ${first[0].timeout}ms to be answered`,
    );
  });

  await check("a browser that answers neither callback is not resolved early", async () => {
    // Safari does this when a prompt is dismissed rather than answered. The
    // fallback timer is the only thing that ever settles it, so the one thing
    // worth asserting cheaply is that nothing else settles it first.
    fakeNavigator(() => {});
    const race = await Promise.race([
      requestPosition(),
      new Promise((r) => setTimeout(() => r("still waiting"), 150)),
    ]);
    assert.equal(race, "still waiting");
  });

  // ─── what gets recorded ───────────────────────────────────────────────────
  await check("a working position records no reason at all", async () => {
    // An absent field has to read as "it worked". If a success carried
    // `positionError: null` every report would have to know to ignore it.
    fakeNavigator((onOk) =>
      onOk({ coords: { latitude: 51.5, longitude: 0.06, accuracy: 9 } }),
    );
    const evidence = await collectClockEvidence();
    assert.equal(evidence.positionError, undefined);
    assert.equal(evidence.positionErrorAfterMs, undefined);
    assert.equal(evidence.coords.accuracyMetres, 9);
  });

  await check("a failure records the reason and how long it took", async () => {
    fakeNavigator((onOk, onErr) => onErr(geoError(1)));
    const evidence = await collectClockEvidence();
    assert.equal(evidence.coords, null);
    assert.equal(evidence.positionError, POSITION_ERROR.DENIED_NO_PROMPT);
    assert.equal(typeof evidence.positionErrorAfterMs, "number");
  });

  // ─── the permission hint, which Safari is allowed to get wrong ────────────
  await check("the permission state is passed through when the browser answers", async () => {
    fakeNavigator(() => {}, {
      permissions: { query: async () => ({ state: "granted" }) },
    });
    assert.equal(await permissionState(), "granted");
  });

  await check("a browser that throws on the descriptor is 'unknown', not a crash", async () => {
    // Older Safari throws a TypeError for the geolocation descriptor. Not
    // knowing is an ordinary answer here, and every caller has to cope with
    // it — this must never be the thing that stops a clock-in.
    fakeNavigator(() => {}, {
      permissions: {
        query: async () => {
          throw new TypeError("GeolocationPermissionDescriptor is not supported");
        },
      },
    });
    assert.equal(await permissionState(), "unknown");

    fakeNavigator(() => {}, undefined);
    assert.equal(await permissionState(), "unknown");
  });

  delete globalThis.navigator;

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [, name] of failed) console.log(`FAIL  ${name}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
