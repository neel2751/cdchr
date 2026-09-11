/**
 * Announcement tests.
 *
 * Runs against the model and audience layer directly rather than the server
 * actions — those read a session through next/headers, which does not exist
 * outside a request. Everything below the session is covered.
 *
 * The test that matters most is "audience agreement". The feature answers the
 * same question from two directions: resolveAudience() turns an audience into
 * people (used for counts, the report and phase-2 email), and visibilityFilter()
 * turns a person into the announcements addressed to them (used on every
 * recipient page load, because resolving each announcement's audience per view
 * would be a query per announcement). Those two can drift, and if they do the
 * author's "40 recipients" stops matching who can actually read it. The
 * agreement test cross-checks every audience against every employee.
 *
 * Needs a LOCAL database — the script refuses anything else, because it writes.
 * If there is no mongod to hand:
 *
 *   docker run -d --name cdchr-test-mongo -p 27017:27017 mongo:7 \
 *     --replSet rs0 --bind_ip_all
 *   docker exec cdchr-test-mongo mongosh --quiet --eval \
 *     'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *     node --import ./scripts/lib/alias-loader.mjs scripts/seed-dev-fixtures.mjs
 *
 * Then:
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   TENANT_ENFORCEMENT=enforce \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-announcements.mjs
 *
 * Run again with TENANT_ENFORCEMENT=shadow. Both must pass: shadow mode adds no
 * tenant filter, so the audience assertions are judged on this tenant's slice
 * and the isolation tests assert the difference explicitly.
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";
const ENFORCING = MODE === "enforce";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const oid = () => new mongoose.Types.ObjectId();

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database seeded with fixtures.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { runWithTenant, runReadOnly } = await import("@/lib/tenantContext");
  const Announcement = (await import("@/models/announcementModel")).default;
  const Receipt = (await import("@/models/announcementReceiptModel")).default;
  const OfficeEmployee = (await import("@/models/officeEmployeeModel")).default;
  const Employe = (await import("@/models/employeModel")).default;
  const Company = (await import("@/models/companyModel")).default;
  const {
    resolveAudience,
    countAudience,
    visibilityFilter,
    roleOfOfficeEmployee,
    getViewer,
    FIELD_ROLE,
  } = await import("@/server/announcementServer/audience");
  const { runAnnouncementPublishJob } = await import(
    "@/server/announcementServer/announcementScheduler"
  );
  const { announcementTemplate, markdownToEmailHtml } = await import(
    "@/server/email/templates/announcementTemplate"
  );
  const { pushAnnouncement } = await import(
    "@/server/announcementServer/announcementPush"
  );

  const acme = await Company.findOne({ slug: "acme" }).lean();
  const beta = await Company.findOne({ slug: "beta" }).lean();
  assert(acme && beta, "fixtures missing — run scripts/seed-dev-fixtures.mjs");

  const A = String(acme._id);
  const B = String(beta._id);

  console.log(`TENANT_ENFORCEMENT=${MODE}\n`);

  // Every Acme fixture employee sits in one department, so a department
  // audience could not be told apart from "everyone". This adds a second.
  const db = mongoose.connection.db;
  const tempDept = oid();
  const tempEmployee = oid();
  await db.collection("roletypes").insertOne({
    _id: tempDept,
    roleTitle: "Finance (test)",
    tenantId: acme._id,
    isActive: true,
    delete: false,
  });
  await db.collection("officeemployes").insertOne({
    _id: tempEmployee,
    name: "Fin Acme",
    email: "finance@acme.test",
    phoneNumber: 7700900001,
    password: "x",
    roleType: "Staff",
    department: tempDept,
    company: acme._id,
    tenantId: acme._id,
    immigrationType: "British",
    employeType: "Full Time",
    joinDate: new Date(2024, 0, 1),
    isActive: true,
    isAdmin: false,
    isSuperAdmin: false,
    delete: false,
  });

  // Field (site) staff. The fixtures have none, and the whole of phase 3 turns
  // on the two populations being handled separately, so two are added here: one
  // on a project site, one with no site at all.
  const tempSite = oid();
  const fieldOnSite = oid();
  const fieldNoSite = oid();
  await db.collection("projectsites").insertOne({
    _id: tempSite,
    siteName: "Camden (test)",
    tenantId: acme._id,
    isActive: true,
    siteDelete: false,
  });
  const fieldEmployee = (id, first, site) => ({
    _id: id,
    firstName: first,
    lastName: "Field",
    email: `${first.toLowerCase()}@acme.test`,
    password: "x",
    phone: 7700900002,
    eAddress: { address: "1 Site Road", postCode: "N1 1AA" },
    employeType: "Full Time",
    cisDeduction: 0,
    payType: "Hourly",
    emergencyName: "Someone",
    projectSite: site,
    tenantId: acme._id,
    isActive: true,
    delete: false,
  });
  await db
    .collection("employes")
    .insertMany([
      fieldEmployee(fieldOnSite, "Sid", tempSite),
      fieldEmployee(fieldNoSite, "Nomad", null),
    ]);

  // Shadow mode adds no tenant filter, so this returns Beta's staff and the
  // orphan fixture too. Narrowing by email keeps the expectations below
  // identical in both modes; the mode difference is asserted where it belongs,
  // in isAcme() and the isolation tests.
  const isAcme = (email) => email.endsWith("@acme.test");
  const acmeStaff = (
    await runWithTenant(A, () =>
      OfficeEmployee.find({ isActive: true, delete: { $ne: true } })
        .select("_id name email department isAdmin isSuperAdmin")
        .lean()
    )
  ).filter((e) => isAcme(e.email));

  const acmeField = (
    await runWithTenant(A, () =>
      Employe.find({ isActive: true, delete: { $ne: true } })
        .select("_id firstName lastName email projectSite")
        .lean()
    )
  ).filter((e) => isAcme(e.email || ""));

  const byEmail = Object.fromEntries(acmeStaff.map((e) => [e.email, e]));
  const superUser = byEmail["super@acme.test"];
  const adminUser = byEmail["admin@acme.test"];
  const plainUser = byEmail["user@acme.test"];
  const financeUser = byEmail["finance@acme.test"];
  assert(
    superUser && adminUser && plainUser && financeUser,
    `expected 4 Acme staff, saw ${acmeStaff.map((e) => e.email).join(", ")}`
  );

  const deptA = String(plainUser.department);

  // The audiences under test, with the answer worked out by hand.
  const AUDIENCES = [
    { name: "all", audience: { mode: "all" }, expect: acmeStaff.map((e) => e.email) },
    {
      name: "roles:[admin]",
      audience: { mode: "roles", roles: ["admin"] },
      expect: ["admin@acme.test"],
    },
    {
      name: "roles:[superAdmin,user]",
      audience: { mode: "roles", roles: ["superAdmin", "user"] },
      expect: ["super@acme.test", "user@acme.test", "finance@acme.test"],
    },
    {
      name: "departments:[Operations]",
      audience: { mode: "departments", departments: [deptA] },
      expect: ["super@acme.test", "admin@acme.test", "user@acme.test"],
    },
    {
      name: "departments:[Finance]",
      audience: { mode: "departments", departments: [String(tempDept)] },
      expect: ["finance@acme.test"],
    },
    {
      name: "people:[user,finance]",
      audience: {
        mode: "people",
        people: [
          { kind: "office", employeeId: String(plainUser._id) },
          { kind: "office", employeeId: String(financeUser._id) },
        ],
      },
      expect: ["user@acme.test", "finance@acme.test"],
    },
    { name: "roles:[] (empty)", audience: { mode: "roles", roles: [] }, expect: [] },
    {
      name: "departments:[] (empty)",
      audience: { mode: "departments", departments: [] },
      expect: [],
    },

    // --- field staff (phase 3) ---
    {
      // Without the opt-in, "everyone" still means the office only. This is the
      // guard on the whole feature: it is what stops an existing announcement
      // suddenly reaching site staff who were never meant to get it.
      name: "all, includeField off",
      audience: { mode: "all", includeField: false },
      expect: acmeStaff.map((e) => e.email),
    },
    {
      name: "all, includeField on",
      audience: { mode: "all", includeField: true },
      expect: [
        ...acmeStaff.map((e) => e.email),
        ...acmeField.map((e) => e.email),
      ],
    },
    {
      name: "roles:[siteEmployee]",
      audience: { mode: "roles", roles: ["siteEmployee"], includeField: true },
      expect: acmeField.map((e) => e.email),
    },
    {
      // A field-only role must not drag in office staff.
      name: "roles:[admin,siteEmployee]",
      audience: {
        mode: "roles",
        roles: ["admin", "siteEmployee"],
        includeField: true,
      },
      expect: ["admin@acme.test", ...acmeField.map((e) => e.email)],
    },
    {
      // Naming a site is naming field staff, so no opt-in is needed — and the
      // field employee with no site must not be swept in.
      name: "sites:[Camden]",
      audience: { mode: "sites", sites: [String(tempSite)] },
      expect: ["sid@acme.test"],
    },
    {
      name: "sites:[] (empty)",
      audience: { mode: "sites", sites: [] },
      expect: [],
    },
    {
      // Departments are an office structure; opting field staff in must not
      // hand them a department they do not have.
      name: "departments:[Operations] + includeField",
      audience: {
        mode: "departments",
        departments: [deptA],
        includeField: true,
      },
      expect: ["super@acme.test", "admin@acme.test", "user@acme.test"],
    },
    {
      name: "people across both populations",
      audience: {
        mode: "people",
        people: [
          { kind: "office", employeeId: String(plainUser._id) },
          { kind: "field", employeeId: String(fieldOnSite) },
        ],
      },
      expect: ["user@acme.test", "sid@acme.test"],
    },
  ];

  const created = [];
  const makeAnnouncement = (tenantId, overrides = {}) =>
    runWithTenant(tenantId, async () => {
      const doc = new Announcement({
        title: "T",
        body: "B",
        status: "published",
        publishedAt: new Date(),
        audience: { mode: "all" },
        ...overrides,
      });
      await doc.save();
      created.push(doc._id);
      return doc;
    });

  // ------------------------------------------------------- resolveAudience --
  for (const { name, audience, expect } of AUDIENCES) {
    await check(`resolveAudience ${name}`, async () => {
      const people = await runWithTenant(A, () => resolveAudience(audience));
      const all = people.map((p) => p.email).sort();
      // Under enforcement the audience must be exactly Acme's people. Under
      // shadow nothing is tenant-filtered, so the audience rules are judged on
      // Acme's slice and the leak itself is what the isolation tests cover.
      const got = ENFORCING ? all : all.filter(isAcme);
      assert.deepEqual(got, [...expect].sort(), `got ${all.join(", ")}`);
    });
  }

  // The count is the denominator on the author's report, so it drifting from
  // the list is the same class of bug as the agreement test below.
  await check("countAudience matches resolveAudience", async () => {
    for (const { name, audience } of AUDIENCES) {
      const [people, count] = await runWithTenant(A, async () => [
        await resolveAudience(audience),
        await countAudience(audience),
      ]);
      assert.equal(count, people.length, `${name}: count ${count} vs ${people.length}`);
    }
  });

  await check("an unrecognised role matches nobody, not everybody", async () => {
    const people = await runWithTenant(A, () =>
      resolveAudience({ mode: "roles", roles: ["notARole"] })
    );
    assert.equal(people.length, 0, `matched ${people.length}`);
  });

  await check("a site nobody is assigned to matches nobody", async () => {
    const people = await runWithTenant(A, () =>
      resolveAudience({ mode: "sites", sites: [String(oid())] })
    );
    assert.equal(people.length, 0);
  });

  // ------------------------------------------------------------ agreement --
  // The invariant: for every audience and every employee,
  //   employee is in resolveAudience(a)  <=>  a is visible to that employee.
  // Both populations, so a field employee's visibility is cross-checked the
  // same way an office one's is. The kind is part of the identity — the two
  // collections have independent id spaces.
  const everyone = [
    ...acmeStaff.map((e) => ({
      kind: "office",
      employeeId: e._id,
      email: e.email,
      role: roleOfOfficeEmployee(e),
      departmentId: e.department,
      siteId: null,
    })),
    ...acmeField.map((e) => ({
      kind: "field",
      employeeId: e._id,
      email: e.email,
      role: FIELD_ROLE,
      departmentId: null,
      siteId: e.projectSite || null,
    })),
  ];

  await check("resolveAudience and visibilityFilter agree", async () => {
    for (const { name, audience } of AUDIENCES) {
      const doc = await makeAnnouncement(A, { audience, title: `agree:${name}` });

      const resolved = new Set(
        (await runWithTenant(A, () => resolveAudience(audience))).map(
          (p) => `${p.kind}:${p.employeeId}`
        )
      );

      for (const viewer of everyone) {
        const visible = await runWithTenant(A, () =>
          Announcement.findOne({
            _id: doc._id,
            ...visibilityFilter(viewer),
          })
            .select("_id")
            .lean()
        );
        const inAudience = resolved.has(
          `${viewer.kind}:${viewer.employeeId}`
        );
        assert.equal(
          !!visible,
          inAudience,
          `${name}: ${viewer.email} (${viewer.kind}) resolved=${inAudience} visible=${!!visible}`
        );
      }
    }
  });

  await check("getViewer resolves a field employee, not an office one", async () => {
    const viewer = await runWithTenant(A, () => getViewer(fieldOnSite, "field"));
    assert.equal(viewer?.kind, "field", `kind was ${viewer?.kind}`);
    assert.equal(viewer?.role, FIELD_ROLE, `role was ${viewer?.role}`);
    assert.equal(
      String(viewer?.siteId),
      String(tempSite),
      `siteId was ${viewer?.siteId}`
    );
  });

  await check("getViewer derives the same role sign-in would", async () => {
    const expected = {
      "super@acme.test": "superAdmin",
      "admin@acme.test": "admin",
      "user@acme.test": "user",
    };
    for (const [email, role] of Object.entries(expected)) {
      const viewer = await runWithTenant(A, () => getViewer(byEmail[email]._id));
      assert.equal(viewer?.role, role, `${email} -> ${viewer?.role}`);
    }
  });

  // ------------------------------------------------------------- isolation --
  await check("an announcement is invisible to another tenant", async () => {
    const doc = await makeAnnouncement(A, { title: "acme-only" });
    const seen = await runWithTenant(B, () =>
      Announcement.findById(doc._id).lean()
    );
    if (ENFORCING) {
      assert.equal(seen, null, "Beta could read an Acme announcement");
    } else {
      assert(seen, "shadow mode must not filter");
    }
  });

  await check("a tenant's list contains only its own announcements", async () => {
    await makeAnnouncement(B, { title: "beta-only" });
    const rows = await runWithTenant(A, () =>
      Announcement.find({ isDeleted: false }).lean()
    );
    if (ENFORCING) {
      const foreign = rows.filter((r) => String(r.tenantId) !== A);
      assert.equal(foreign.length, 0, `${foreign.length} foreign rows`);
      assert(rows.length > 0, "expected Acme's own rows");
    }
  });

  await check("save() stamps the tenant on a new announcement", async () => {
    const doc = await makeAnnouncement(A, { title: "stamped" });
    assert.equal(String(doc.tenantId), A, `tenantId was ${doc.tenantId}`);
  });

  // ------------------------------------------------------- the live filter --
  const liveFilter = (viewer) => ({
    status: "published",
    isDeleted: false,
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
      visibilityFilter(viewer),
    ],
  });

  const viewerFor = (employee) => ({
    employeeId: employee._id,
    role: roleOfOfficeEmployee(employee),
    departmentId: employee.department,
  });

  await check("a draft is not visible to recipients", async () => {
    const doc = await makeAnnouncement(A, { title: "draft", status: "draft" });
    const seen = await runWithTenant(A, () =>
      Announcement.findOne({ _id: doc._id, ...liveFilter(viewerFor(plainUser)) }).lean()
    );
    assert.equal(seen, null);
  });

  await check("an archived announcement is not visible to recipients", async () => {
    const doc = await makeAnnouncement(A, { title: "arch", status: "archived" });
    const seen = await runWithTenant(A, () =>
      Announcement.findOne({ _id: doc._id, ...liveFilter(viewerFor(plainUser)) }).lean()
    );
    assert.equal(seen, null);
  });

  await check("an expired announcement drops out with no job having run", async () => {
    const doc = await makeAnnouncement(A, {
      title: "expired",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const seen = await runWithTenant(A, () =>
      Announcement.findOne({ _id: doc._id, ...liveFilter(viewerFor(plainUser)) }).lean()
    );
    assert.equal(seen, null);
  });

  await check("an announcement expiring in the future is still visible", async () => {
    const doc = await makeAnnouncement(A, {
      title: "not-yet-expired",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const seen = await runWithTenant(A, () =>
      Announcement.findOne({ _id: doc._id, ...liveFilter(viewerFor(plainUser)) }).lean()
    );
    assert(seen, "should still be visible");
  });

  await check("important and urgent pin above normal", async () => {
    const marker = `pin-${Date.now()}`;
    const base = new Date();
    await makeAnnouncement(A, {
      title: `${marker}-normal`,
      priority: "normal",
      publishedAt: new Date(base.getTime() + 3000), // newest
    });
    await makeAnnouncement(A, {
      title: `${marker}-important`,
      priority: "important",
      publishedAt: new Date(base.getTime() + 1000),
    });
    await makeAnnouncement(A, {
      title: `${marker}-urgent`,
      priority: "urgent",
      publishedAt: new Date(base.getTime() + 2000),
    });

    const rows = await runWithTenant(A, () =>
      Announcement.aggregate([
        { $match: { title: { $regex: `^${marker}` } } },
        {
          $addFields: {
            pinRank: {
              $cond: [{ $in: ["$priority", ["important", "urgent"]] }, 0, 1],
            },
          },
        },
        { $sort: { pinRank: 1, publishedAt: -1 } },
        { $project: { title: 1 } },
      ])
    );

    assert.deepEqual(
      rows.map((r) => r.title),
      [`${marker}-urgent`, `${marker}-important`, `${marker}-normal`],
      // Sorting on the priority string alone would give important < normal <
      // urgent, putting the normal one in the middle.
      `got ${rows.map((r) => r.title).join(", ")}`
    );
  });

  // ------------------------------------------------------------- scheduler --
  await check("the scheduler publishes what is due and leaves what is not", async () => {
    const marker = `sched-${Date.now()}`;
    const due = await makeAnnouncement(A, {
      title: `${marker}-due`,
      status: "scheduled",
      publishedAt: null,
      publishAt: new Date(Date.now() - 60_000),
    });
    const notDue = await makeAnnouncement(A, {
      title: `${marker}-future`,
      status: "scheduled",
      publishedAt: null,
      publishAt: new Date(Date.now() + 60 * 60_000),
    });

    const results = await runAnnouncementPublishJob();
    assert(results.published >= 1, `published ${results.published}`);

    const [after, untouched] = await runWithTenant(A, async () => [
      await Announcement.findById(due._id).lean(),
      await Announcement.findById(notDue._id).lean(),
    ]);

    assert.equal(after.status, "published", `due was ${after.status}`);
    assert(after.publishedAt, "publishedAt was not set");
    // Compared against a live count rather than the fixture size: under shadow
    // the audience is not tenant-filtered, so the correct number differs by
    // mode. What matters is that the snapshot matches what the audience
    // actually resolves to right now.
    const expectedCount = await runWithTenant(A, () =>
      countAudience({ mode: "all" })
    );
    assert.equal(
      after.recipientCount,
      expectedCount,
      `recipientCount ${after.recipientCount} vs ${expectedCount}`
    );
    assert.equal(
      untouched.status,
      "scheduled",
      `a future announcement was published early (${untouched.status})`
    );
  });

  await check("running the scheduler twice publishes nothing twice", async () => {
    const doc = await makeAnnouncement(A, {
      title: `sched-once-${Date.now()}`,
      status: "scheduled",
      publishedAt: null,
      publishAt: new Date(Date.now() - 60_000),
    });

    const first = await runAnnouncementPublishJob();
    const firstAt = (await runWithTenant(A, () =>
      Announcement.findById(doc._id).lean()
    )).publishedAt;

    const second = await runAnnouncementPublishJob();
    const secondAt = (await runWithTenant(A, () =>
      Announcement.findById(doc._id).lean()
    )).publishedAt;

    assert(first.published >= 1, "first run should publish");
    assert.equal(
      String(firstAt),
      String(secondAt),
      // The status guard in the update is what makes overlapping ticks safe.
      "a second run re-published an already-published announcement"
    );
    assert.equal(second.published, 0, `second run published ${second.published}`);
  });

  await check("the scheduler does not cross tenants", async () => {
    const doc = await makeAnnouncement(B, {
      title: `sched-beta-${Date.now()}`,
      status: "scheduled",
      publishedAt: null,
      publishAt: new Date(Date.now() - 60_000),
    });
    await runAnnouncementPublishJob();
    const after = await runWithTenant(B, () =>
      Announcement.findById(doc._id).lean()
    );
    assert.equal(String(after.tenantId), B, "Beta's announcement changed hands");
    assert.equal(after.status, "published");
  });

  // ------------------------------------------------------------ email body --
  await check("markdown becomes email HTML, and HTML in the body does not", async () => {
    const html = markdownToEmailHtml(
      "# Notice\n\nThe office is **closed**.\n\n- Monday\n- Tuesday\n\n" +
        "<script>alert(1)</script>\n\n[link](https://example.com)"
    );

    assert(html.includes("<strong>closed</strong>"), "bold was not rendered");
    assert(html.includes("<li>Monday</li>"), "list was not rendered");
    assert(
      html.includes('<a href="https://example.com"'),
      "link was not rendered"
    );
    // The body is authored by an admin and mailed to the whole company, so a
    // raw tag has to come out as text.
    assert(
      !html.includes("<script>"),
      `script tag survived escaping: ${html}`
    );
    assert(html.includes("&lt;script&gt;"), "script tag was not escaped");
  });

  await check("a javascript: link is dropped, not rendered", async () => {
    const html = markdownToEmailHtml("[click](javascript:alert(1))");
    assert(!/href="javascript/i.test(html), `unsafe href survived: ${html}`);
    assert(html.includes("click"), "the label should survive as plain text");
  });

  await check("the email subject carries the priority", async () => {
    const urgent = announcementTemplate({
      title: "Fire drill",
      body: "x",
      priority: "urgent",
    });
    const normal = announcementTemplate({
      title: "Fire drill",
      body: "x",
      priority: "normal",
    });
    assert.equal(urgent.subject, "Urgent: Fire drill");
    assert.equal(normal.subject, "Fire drill");
  });

  // ---------------------------------------------------------------- report --
  await check("the report counts read and acknowledged separately", async () => {
    const doc = await makeAnnouncement(A, {
      title: `report-${Date.now()}`,
      requireAck: true,
      audience: { mode: "all" },
    });

    await runWithTenant(A, () =>
      Receipt.create({
        announcementId: doc._id,
        employeeId: plainUser._id,
        employeeKind: "office",
        readAt: new Date(),
      })
    );
    await runWithTenant(A, () =>
      Receipt.create({
        announcementId: doc._id,
        employeeId: adminUser._id,
        employeeKind: "office",
        readAt: new Date(),
        acknowledgedAt: new Date(),
      })
    );

    const recipients = await runWithTenant(A, () =>
      resolveAudience(doc.audience)
    );
    const receipts = await runWithTenant(A, () =>
      Receipt.find({ announcementId: doc._id }).lean()
    );

    const read = receipts.filter((r) => r.readAt).length;
    const acked = receipts.filter((r) => r.acknowledgedAt).length;

    const expectedSize = await runWithTenant(A, () =>
      countAudience({ mode: "all" })
    );
    assert.equal(recipients.length, expectedSize, "wrong audience size");
    assert.equal(read, 2, `read ${read}`);
    // Acknowledged must be a strict subset of read — a report that conflated
    // them would tell an author a safety notice was signed off when it was
    // merely opened.
    assert.equal(acked, 1, `acknowledged ${acked}`);
  });

  // -------------------------------------------------------------------- push --
  await check("push clears an unusable subscription instead of retrying it", async () => {
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      return; // push not configured in this environment; nothing to assert
    }

    const doc = await makeAnnouncement(A, {
      title: `push-${Date.now()}`,
      channels: { inApp: true, email: false, push: true },
    });

    // Malformed keys, which is one of the two permanent failures (the other is
    // a 410 from the push service, which needs a live endpoint to provoke).
    // Deliberately offline: no network call is made for this row.
    await runWithTenant(A, () =>
      Employe.findByIdAndUpdate(fieldOnSite, {
        pushSubscription: {
          endpoint: "https://fcm.googleapis.com/fcm/send/dead-endpoint",
          keys: { p256dh: "x", auth: "y" },
        },
      })
    );

    const result = await runWithTenant(A, () =>
      pushAnnouncement(doc.toObject(), [
        { kind: "field", employeeId: fieldOnSite },
      ])
    );

    assert.equal(result.cleared, 1, `cleared ${result.cleared}`);
    assert.equal(result.sent, 0, `sent ${result.sent}`);

    const after = await runWithTenant(A, () =>
      Employe.findById(fieldOnSite).select("pushSubscription").lean()
    );
    assert.equal(
      after.pushSubscription,
      null,
      "a permanently broken subscription was left to be retried forever"
    );
  });

  await check("push skips people who never subscribed", async () => {
    const doc = await makeAnnouncement(A, {
      title: `push-skip-${Date.now()}`,
      channels: { inApp: true, email: false, push: true },
    });
    const result = await runWithTenant(A, () =>
      pushAnnouncement(doc.toObject(), [
        { kind: "field", employeeId: fieldNoSite },
      ])
    );
    assert.equal(result.skipped, 1, `skipped ${result.skipped}`);
    assert.equal(result.failed, 0, `failed ${result.failed}`);
  });

  // ---------------------------------------------------------------- receipts --
  await check("a receipt records which population the reader is from", async () => {
    const doc = await makeAnnouncement(A, {
      title: `kind-${Date.now()}`,
      audience: { mode: "all", includeField: true },
    });

    await runWithTenant(A, () =>
      Receipt.create({
        announcementId: doc._id,
        employeeId: fieldOnSite,
        employeeKind: "field",
        readAt: new Date(),
      })
    );

    const receipt = await runWithTenant(A, () =>
      Receipt.findOne({ announcementId: doc._id, employeeId: fieldOnSite }).lean()
    );
    assert.equal(receipt.employeeKind, "field", `kind was ${receipt.employeeKind}`);
  });

  await check("a receipt is stamped with the tenant", async () => {
    const doc = await makeAnnouncement(A, { title: "receipt-tenant" });
    const receipt = await runWithTenant(A, () =>
      Receipt.create({
        announcementId: doc._id,
        employeeId: plainUser._id,
        employeeKind: "office",
        readAt: new Date(),
      })
    );
    assert.equal(
      String(receipt.tenantId),
      A,
      // create() goes through save(), which stamps in both modes. An upsert
      // would not: in shadow mode the plugin adds no filter for Mongo to copy
      // into the inserted document.
      `tenantId was ${receipt.tenantId}`
    );
  });

  await check("a second receipt for the same person is rejected", async () => {
    const doc = await makeAnnouncement(A, { title: "receipt-dupe" });
    const write = () =>
      runWithTenant(A, () =>
        Receipt.create({
          announcementId: doc._id,
          employeeId: plainUser._id,
          employeeKind: "office",
          readAt: new Date(),
        })
      );
    await write();
    await assert.rejects(write, (e) => e.code === 11000, "expected a duplicate key error");
  });

  await check("a read-only support session cannot write a receipt", async () => {
    const doc = await makeAnnouncement(A, { title: "receipt-readonly" });
    await assert.rejects(
      () =>
        runWithTenant(A, () =>
          runReadOnly(() =>
            Receipt.create({
              announcementId: doc._id,
              employeeId: adminUser._id,
              employeeKind: "office",
            })
          )
        ),
      (e) => e.isReadOnlyError === true,
      "expected ReadOnlySessionError"
    );
  });

  await check("a read-only support session cannot publish", async () => {
    const doc = await makeAnnouncement(A, { title: "publish-readonly", status: "draft" });
    await assert.rejects(
      () =>
        runWithTenant(A, () =>
          runReadOnly(() =>
            Announcement.findByIdAndUpdate(doc._id, { status: "published" })
          )
        ),
      (e) => e.isReadOnlyError === true,
      "expected ReadOnlySessionError"
    );
  });

  // ------------------------------------------------------------------ tidy --
  await runWithTenant(A, () => Receipt.deleteMany({ announcementId: { $in: created } }));
  await db.collection("announcements").deleteMany({ _id: { $in: created } });
  await db.collection("announcementreceipts").deleteMany({
    announcementId: { $in: created },
  });
  await db.collection("officeemployes").deleteOne({ _id: tempEmployee });
  await db.collection("roletypes").deleteOne({ _id: tempDept });
  await db
    .collection("employes")
    .deleteMany({ _id: { $in: [fieldOnSite, fieldNoSite] } });
  await db.collection("projectsites").deleteOne({ _id: tempSite });
  // The scheduler writes an audit entry per publish, which would otherwise
  // accumulate every time this runs.
  await db
    .collection("auditlogs")
    .deleteMany({ module: "Announcement", entityId: { $in: created } });

  const failed = results.filter(([status]) => status === "FAIL");
  for (const [status, name] of results) {
    console.log(`${status === "pass" ? "  ok  " : "  FAIL"}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed (${MODE})`
  );

  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
