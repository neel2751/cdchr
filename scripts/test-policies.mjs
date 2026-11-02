/**
 * Policy library tests.
 *
 * Drives the real server actions with a stubbed session (scripts/lib/
 * action-loader.mjs), so the permission checks under test are the ones that
 * run in production rather than a re-implementation of them.
 *
 * What matters most, in order:
 *   1. Who may read a policy. Hidden, archived, unpublished, outside the
 *      audience, site staff, another company — none of them may list or open
 *      it, and the file key never reaches a reader.
 *   2. Who may manage one. The plan, then the page permission.
 *   3. That history cannot be rewritten: published versions are numbered
 *      without gaps, cannot be deleted, and a policy that was ever in force
 *      cannot be deleted either.
 *
 * NOTHING HERE TOUCHES S3. The AWS endpoint is pointed at a closed local port
 * with dummy credentials before anything is imported. Signing a URL is local
 * arithmetic and still works; every real call (HeadObject, DeleteObject)
 * fails at once, which is the path the "upload did not arrive" test needs.
 * Uploaded drafts are therefore written straight to the model.
 *
 * Needs a LOCAL database seeded with scripts/seed-dev-fixtures.mjs — see the
 * header of scripts/test-announcements.mjs for a one-line docker setup. Then:
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   TENANT_ENFORCEMENT=enforce npm run policies:test
 *
 * and again with TENANT_ENFORCEMENT=shadow.
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

// Before any import that builds an S3 client.
process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:9";
process.env.AWS_ACCESS_ID = "test";
process.env.AWS_ACCESS_PORTAL_KEY = "test";
process.env.AWS_REGION = "eu-west-2";
process.env.AWS_BUCKET_NAME = "policy-tests-not-a-bucket";

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";
// Company isolation is the tenant plugin's job, and shadow mode adds no
// filter. The cross-company tests assert isolation when enforcing and assert
// its absence otherwise — so they prove the isolation comes from the plugin
// and would notice if it ever stopped doing so.
const ENFORCING = MODE === "enforce";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const parse = (res) => (res?.data ? JSON.parse(res.data) : null);

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database seeded with fixtures.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const { runWithTenant } = await import("@/lib/tenantContext");
  const { actAs } = await import("@/scripts/lib/session-stub");
  const Company = (await import("@/models/companyModel")).default;
  const Policy = (await import("@/models/policyModel")).default;
  const PolicyVersion = (await import("@/models/policyVersionModel")).default;
  const PolicyCategory = (await import("@/models/policyCategoryModel")).default;
  const admin = await import("@/server/policyServer/policyServer");
  const reader = await import("@/server/policyServer/myPolicyServer");
  const PolicyReview = (await import("@/models/policyReviewModel")).default;
  const { runPolicyReviewJob } = await import("@/server/policyServer/policyReviewJob");
  const { getWorkingDate } = await import("@/lib/clockTime");
  const { addMonthsToDay, reviewMilestone } = await import("@/lib/policies");

  await Promise.all([
    PolicyVersion.syncIndexes(),
    PolicyCategory.syncIndexes(),
  ]);

  const [acme, beta] = await Promise.all([
    Company.findOne({ slug: "acme" }).lean(),
    Company.findOne({ slug: "beta" }).lean(),
  ]);
  assert(acme && beta, "fixtures missing — run scripts/seed-dev-fixtures.mjs");
  const A = String(acme._id);
  const B = String(beta._id);

  const staff = await db.collection("officeemployes").find({}).toArray();
  const byEmail = Object.fromEntries(staff.map((s) => [s.email, s]));
  const session = (email, role, tenantId) => ({
    _id: String(byEmail[email]._id),
    role,
    tenantId,
    name: byEmail[email].name,
  });
  const acmeSuper = session("super@acme.test", "superAdmin", A);
  const acmeAdmin = session("admin@acme.test", "admin", A);
  const acmeUser = session("user@acme.test", "user", A);
  const betaSuper = session("super@beta.test", "superAdmin", B);
  const betaAdmin = session("admin@beta.test", "admin", B);

  // A second Acme department with one person in it, so a department audience
  // can be told apart from "everyone".
  const financeDept = new mongoose.Types.ObjectId();
  const financePerson = new mongoose.Types.ObjectId();
  await db.collection("roletypes").insertOne({
    _id: financeDept,
    roleTitle: "Finance (policy test)",
    tenantId: acme._id,
    isActive: true,
    delete: false,
  });
  await db.collection("officeemployes").insertOne({
    ...byEmail["user@acme.test"],
    _id: financePerson,
    name: "Fiona Finance",
    email: "fiona@acme.test",
    department: financeDept,
  });
  const acmeFinance = {
    _id: String(financePerson),
    role: "user",
    tenantId: A,
    name: "Fiona Finance",
  };

  const as = (user, fn) =>
    runWithTenant(user.tenantId, async () => {
      actAs(user);
      try {
        return await fn();
      } finally {
        actAs(null);
      }
    });

  /** A draft written straight to the model — see the header on S3. */
  const insertDraft = (user, policyId, fileName = "policy.pdf") =>
    as(user, () =>
      PolicyVersion.create({
        policyId,
        status: "draft",
        file: {
          key: `tenants/${user.tenantId}/policies/${policyId}/${new mongoose.Types.ObjectId()}-${fileName}`,
          fileName,
          fileType: "application/pdf",
          fileSize: 1234,
        },
      }),
    );

  console.log(`TENANT_ENFORCEMENT=${MODE}\n`);

  try {
    /* ------------------------------------------------------ who manages */

    await check("an employee cannot manage policies", async () => {
      const res = await as(acmeUser, () => admin.createPolicy({ title: "x" }));
      assert.equal(res.success, false);
      const list = await as(acmeUser, () => admin.getPolicyCategories());
      assert.deepEqual(parse(list), []);
    });

    await check("an admin without the Policies page cannot manage them", async () => {
      const res = await as(acmeAdmin, () => admin.createPolicy({ title: "x" }));
      assert.equal(res.success, false);
      assert.equal(res.message, "Not authorized");
    });

    await db.collection("rolebaseds").updateMany(
      { employeeId: { $in: [byEmail["admin@acme.test"]._id, byEmail["admin@beta.test"]._id] } },
      { $addToSet: { permissions: "/admin/policies" } },
    );

    await check("a plan without the module refuses even a super admin", async () => {
      await db.collection("companies").updateOne(
        { _id: acme._id },
        { $set: { "features.policies": false } },
      );
      try {
        const res = await as(acmeSuper, () => admin.canManagePolicies());
        assert.equal(parse(res), false);
      } finally {
        await db.collection("companies").updateOne(
          { _id: acme._id },
          { $unset: { "features.policies": "" } },
        );
      }
      assert.equal(parse(await as(acmeSuper, () => admin.canManagePolicies())), true);
    });

    /* ------------------------------------------------------ categories */

    let categories;
    await check("the library opens with the six default categories, once", async () => {
      categories = parse(await as(acmeAdmin, () => admin.getPolicyCategories()));
      assert.deepEqual(
        categories.map((c) => c.name),
        ["HR", "IT", "Finance", "Health & Safety", "Fire Safety", "Data Protection"],
      );
      const again = parse(await as(acmeAdmin, () => admin.getPolicyCategories()));
      assert.equal(again.length, 6);
    });

    await check("two first visits at once still make six, not twelve", async () => {
      await Promise.all([
        as(betaSuper, () => admin.getPolicyCategories()),
        as(betaAdmin, () => admin.getPolicyCategories()),
      ]);
      const list = parse(await as(betaSuper, () => admin.getPolicyCategories()));
      assert.equal(list.length, 6);
    });

    const categoryId = (name) => String(categories.find((c) => c.name === name)._id);

    await check("a category name differing only in case and spacing is a duplicate", async () => {
      const res = await as(acmeAdmin, () =>
        admin.savePolicyCategory({ name: "  fire   SAFETY " }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /already a category/);
    });

    let environmental;
    await check("re-adding an archived category restores it", async () => {
      const created = await as(acmeAdmin, () =>
        admin.savePolicyCategory({ name: "Environmental" }),
      );
      assert.equal(created.success, true, created.message);
      environmental = parse(created)._id;

      const archived = await as(acmeAdmin, () =>
        admin.setPolicyCategoryArchived(environmental, true),
      );
      assert.equal(archived.success, true, archived.message);

      const again = await as(acmeAdmin, () =>
        admin.savePolicyCategory({ name: "environmental" }),
      );
      assert.equal(again.success, true, again.message);
      assert.equal(String(parse(again)._id), String(environmental));
      const count = await as(acmeAdmin, () =>
        PolicyCategory.countDocuments({ nameKey: "environmental" }),
      );
      assert.equal(count, 1);
    });

    /* -------------------------------------------------------- policies */

    await check("a policy needs a title and a live category", async () => {
      const noTitle = await as(acmeAdmin, () =>
        admin.createPolicy({ categoryId: categoryId("HR") }),
      );
      assert.equal(noTitle.success, false);

      await as(acmeAdmin, () => admin.setPolicyCategoryArchived(environmental, true));
      const archivedCategory = await as(acmeAdmin, () =>
        admin.createPolicy({ title: "Recycling", categoryId: environmental }),
      );
      assert.equal(archivedCategory.success, false);
      assert.match(archivedCategory.message, /archived/);
    });

    await check("the owner must be on this company's staff", async () => {
      const res = await as(acmeAdmin, () =>
        admin.createPolicy({
          title: "Expenses",
          categoryId: categoryId("Finance"),
          ownerId: String(byEmail["admin@beta.test"]._id),
        }),
      );
      if (ENFORCING) {
        assert.equal(res.success, false);
        assert.match(res.message, /owner/i);
      } else {
        assert.equal(res.success, true, "shadow mode must not filter");
        await as(acmeAdmin, () => admin.deletePolicy(parse(res)._id));
      }
    });

    const fire = parse(
      await as(acmeAdmin, () =>
        admin.createPolicy({
          title: "Fire Evacuation",
          summary: "Where to go when the alarm sounds.",
          categoryId: categoryId("Fire Safety"),
          ownerId: String(byEmail["admin@acme.test"]._id),
        }),
      ),
    )._id;

    await check("a category holding a live policy cannot be archived", async () => {
      const res = await as(acmeAdmin, () =>
        admin.setPolicyCategoryArchived(categoryId("Fire Safety"), true),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /still has 1 policy/);
    });

    /* --------------------------------------------------------- uploads */

    await check("an upload is refused for a type a policy cannot be", async () => {
      const res = await as(acmeAdmin, () =>
        admin.startPolicyUpload({
          policyId: fire,
          fileName: "run-me.exe",
          contentType: "application/x-msdownload",
          fileSize: 1000,
        }),
      );
      assert.equal(res.success, false);
    });

    await check("an upload over 25 MB is refused before anything is signed", async () => {
      const res = await as(acmeAdmin, () =>
        admin.startPolicyUpload({
          policyId: fire,
          fileName: "scan.pdf",
          contentType: "application/pdf",
          fileSize: 26 * 1024 * 1024,
        }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /25 MB/);
    });

    await check("a signed upload lands under this policy, at an unguessable key", async () => {
      const res = await as(acmeAdmin, () =>
        admin.startPolicyUpload({
          policyId: fire,
          fileName: "Fire plan (v1).pdf",
          contentType: "application/pdf",
          fileSize: 2048,
        }),
      );
      assert.equal(res.success, true, res.message);
      const { key, url } = parse(res);
      assert(key.startsWith(`tenants/${A}/policies/${fire}/`), key);
      assert.match(key, /\/[0-9a-f-]{36}-Fire plan _v1_\.pdf$/);
      assert(url.includes("X-Amz-Signature"), "not a signed URL");
    });

    await check("a file from another policy's or company's folder is refused", async () => {
      const other = `tenants/${A}/policies/${new mongoose.Types.ObjectId()}/x.pdf`;
      const beta = `tenants/${B}/policies/${fire}/x.pdf`;
      for (const key of [other, beta, `tenants/${A}/policies/${fire}x/y.pdf`]) {
        const res = await as(acmeAdmin, () =>
          admin.addPolicyVersion({ policyId: fire, key, fileName: "x.pdf" }),
        );
        assert.equal(res.success, false, key);
        assert.match(res.message, /does not belong/);
      }
    });

    await check("a file that never arrived is not recorded", async () => {
      const res = await as(acmeAdmin, () =>
        admin.addPolicyVersion({
          policyId: fire,
          key: `tenants/${A}/policies/${fire}/missing.pdf`,
          fileName: "missing.pdf",
        }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /did not arrive/);
    });

    /* ------------------------------------------------------ publishing */

    await check("nothing published means nothing can be shown to staff", async () => {
      const res = await as(acmeAdmin, () =>
        admin.setPolicyVisibility(fire, { visibleToEmployees: true, audience: { mode: "all" } }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /Publish a version first/);
    });

    const draft1 = await insertDraft(acmeAdmin, fire, "v1.pdf");

    await check("only one draft at a time", async () => {
      const res = await as(acmeAdmin, () =>
        admin.startPolicyUpload({
          policyId: fire,
          fileName: "another.pdf",
          contentType: "application/pdf",
          fileSize: 10,
        }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /already has a draft/);
    });

    await check("publishing the first draft makes it version 1, in force", async () => {
      const res = await as(acmeAdmin, () => admin.publishPolicyVersion(String(draft1._id)));
      assert.equal(res.success, true, res.message);
      const policy = await as(acmeAdmin, () => Policy.findById(fire).lean());
      assert.equal(policy.status, "active");
      assert.equal(policy.currentVersionNumber, 1);
      assert.equal(String(policy.currentVersionId), String(draft1._id));
    });

    await check("a published version cannot be published again or deleted", async () => {
      const again = await as(acmeAdmin, () => admin.publishPolicyVersion(String(draft1._id)));
      assert.equal(again.success, false);
      const del = await as(acmeAdmin, () => admin.deletePolicyDraft(String(draft1._id)));
      assert.equal(del.success, false);
      assert.match(del.message, /kept as history/);
    });

    await check("a change note is required from the second version on", async () => {
      const res = await as(acmeAdmin, () =>
        admin.addPolicyVersion({
          policyId: fire,
          key: `tenants/${A}/policies/${fire}/v2.pdf`,
          fileName: "v2.pdf",
        }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /what changed/i);
    });

    await check("a deleted draft leaves no gap: the next publish is version 2", async () => {
      const abandoned = await insertDraft(acmeAdmin, fire, "abandoned.pdf");
      const del = await as(acmeAdmin, () => admin.deletePolicyDraft(String(abandoned._id)));
      assert.equal(del.success, true, del.message);

      const draft2 = await insertDraft(acmeAdmin, fire, "v2.pdf");
      const res = await as(acmeAdmin, () => admin.publishPolicyVersion(String(draft2._id)));
      assert.equal(res.success, true, res.message);

      const versions = await as(acmeAdmin, () =>
        PolicyVersion.find({ policyId: fire, isDeleted: false }).sort({ versionNumber: 1 }).lean(),
      );
      assert.deepEqual(
        versions.map((v) => [v.versionNumber, v.status]),
        [
          [1, "superseded"],
          [2, "published"],
        ],
      );
    });

    await check("a policy that was ever published cannot be deleted", async () => {
      const res = await as(acmeAdmin, () => admin.deletePolicy(fire));
      assert.equal(res.success, false);
      assert.match(res.message, /Archive it instead/);
    });

    await check("a policy never published can be deleted", async () => {
      const id = parse(
        await as(acmeAdmin, () =>
          admin.createPolicy({ title: "Scratch", categoryId: categoryId("IT") }),
        ),
      )._id;
      await insertDraft(acmeAdmin, id);
      const res = await as(acmeAdmin, () => admin.deletePolicy(id));
      assert.equal(res.success, true, res.message);
    });

    await check("publishing is in the audit log", async () => {
      const entries = await db
        .collection("auditlogs")
        .countDocuments({ action: "Policy.publishVersion", entityId: { $in: [fire, new mongoose.Types.ObjectId(fire)] } });
      assert(entries >= 2, `expected 2+ entries, found ${entries}`);
    });

    /* -------------------------------------------------- who can read it */

    const readable = async (user) => {
      const groups = parse(await as(user, () => reader.getMyPolicies())) || [];
      return groups.flatMap((g) => g.policies.map((p) => p.title));
    };

    await check("a published but hidden policy is invisible to staff", async () => {
      assert.deepEqual(await readable(acmeUser), []);
      const open = await as(acmeUser, () => reader.openMyPolicy(fire));
      assert.equal(open.success, false);
      assert.equal(open.message, "Policy not found");
    });

    await check("site staff and site targeting are stripped from the audience", async () => {
      const res = await as(acmeAdmin, () =>
        admin.setPolicyVisibility(fire, {
          visibleToEmployees: true,
          audience: {
            mode: "all",
            includeField: true,
            sites: [String(new mongoose.Types.ObjectId())],
            roles: ["siteEmployee"],
          },
        }),
      );
      assert.equal(res.success, true, res.message);
      const policy = await as(acmeAdmin, () => Policy.findById(fire).lean());
      assert.equal(policy.audience.includeField, false);
      assert.deepEqual(policy.audience.sites, []);
      assert.deepEqual(policy.audience.roles, []);
    });

    await check("shown to everyone: every office employee reads version 2", async () => {
      for (const user of [acmeUser, acmeFinance, acmeAdmin]) {
        assert.deepEqual(await readable(user), ["Fire Evacuation"], user.name);
      }
      const [group] = parse(await as(acmeUser, () => reader.getMyPolicies()));
      assert.equal(group.name, "Fire Safety");
      assert.equal(group.policies[0].versionNumber, 2);
      assert.equal(group.policies[0].badge, "updated");
    });

    await check("a reader is never sent a file key", async () => {
      const raw = (await as(acmeUser, () => reader.getMyPolicies())).data;
      assert(!raw.includes("tenants/"), "a storage key reached the reader");
      const managerView = (await as(acmeAdmin, () => admin.getPolicyById(fire))).data;
      assert(!managerView.includes("tenants/"), "a storage key reached the detail page");
    });

    await check("opening signs the version in force, not an older one", async () => {
      const res = await as(acmeUser, () => reader.openMyPolicy(fire));
      assert.equal(res.success, true, res.message);
      const { url } = parse(res);
      assert(url.includes("v2.pdf"), url);
    });

    await check("a department audience reaches that department only", async () => {
      const res = await as(acmeAdmin, () =>
        admin.setPolicyVisibility(fire, {
          visibleToEmployees: true,
          audience: { mode: "departments", departments: [String(financeDept)] },
        }),
      );
      assert.equal(res.success, true, res.message);
      assert.match(res.message, /Visible to 1 person/);
      assert.deepEqual(await readable(acmeFinance), ["Fire Evacuation"]);
      assert.deepEqual(await readable(acmeUser), []);
      const open = await as(acmeUser, () => reader.openMyPolicy(fire));
      assert.equal(open.success, false);
    });

    await check("a hand-picked audience reaches those people only", async () => {
      await as(acmeAdmin, () =>
        admin.setPolicyVisibility(fire, {
          visibleToEmployees: true,
          audience: {
            mode: "people",
            people: [{ kind: "office", employeeId: acmeUser._id }],
          },
        }),
      );
      assert.deepEqual(await readable(acmeUser), ["Fire Evacuation"]);
      assert.deepEqual(await readable(acmeFinance), []);
    });

    await check("an audience of nobody is refused rather than saved", async () => {
      const res = await as(acmeAdmin, () =>
        admin.setPolicyVisibility(fire, {
          visibleToEmployees: true,
          audience: { mode: "roles", roles: [] },
        }),
      );
      assert.equal(res.success, false);
    });

    await check("site staff see no policies at all", async () => {
      await as(acmeAdmin, () =>
        admin.setPolicyVisibility(fire, { visibleToEmployees: true, audience: { mode: "all" } }),
      );
      const site = { ...acmeUser, role: "siteEmployee" };
      assert.deepEqual(await readable(site), []);
      const open = await as(site, () => reader.openMyPolicy(fire));
      assert.equal(open.success, false);
    });

    await check("another company's staff cannot list or open it", async () => {
      const titles = await readable(betaAdmin);
      const open = await as(betaAdmin, () => reader.openMyPolicy(fire));
      if (ENFORCING) {
        assert.deepEqual(titles, []);
        assert.equal(open.success, false);
      } else {
        assert.deepEqual(titles, ["Fire Evacuation"], "shadow mode must not filter");
      }
    });

    await check("another company's managers cannot touch it", async () => {
      const res = await as(betaAdmin, () => admin.getPolicyById(fire));
      if (ENFORCING) {
        assert.equal(res.success, false);
        const hide = await as(betaAdmin, () =>
          admin.setPolicyVisibility(fire, { visibleToEmployees: false }),
        );
        assert.equal(hide.success, false);
      } else {
        assert.equal(res.success, true, "shadow mode must not filter");
      }
    });

    await check("archiving hides it, and restoring does not re-show it", async () => {
      const archived = await as(acmeAdmin, () => admin.setPolicyArchived(fire, true));
      assert.equal(archived.success, true, archived.message);
      assert.deepEqual(await readable(acmeUser), []);

      const restored = await as(acmeAdmin, () => admin.setPolicyArchived(fire, false));
      assert.equal(restored.success, true, restored.message);
      const policy = await as(acmeAdmin, () => Policy.findById(fire).lean());
      assert.equal(policy.status, "active");
      assert.equal(policy.visibleToEmployees, false);
      assert.deepEqual(await readable(acmeUser), []);
    });

    /* ------------------------------------------------------------ reviews */

    const DAY = 86400000;
    const today = getWorkingDate();
    const dayKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    const loadFire = () => as(acmeAdmin, () => Policy.findById(fire).lean());

    await check("months are added to the day, clamped to the end of the month", () => {
      const day = (s) => new Date(`${s}T00:00:00Z`);
      assert.equal(dayKey(addMonthsToDay(day("2027-01-31"), 1)), "2027-02-28");
      assert.equal(dayKey(addMonthsToDay(day("2028-01-31"), 1)), "2028-02-29");
      assert.equal(dayKey(addMonthsToDay(day("2026-11-02"), 12)), "2027-11-02");
      assert.equal(dayKey(addMonthsToDay(day("2026-08-31"), 6)), "2027-02-28");
    });

    await check("reminder bands: 30 days, 7 days, the day, then weekly", () => {
      const cases = [
        [31, null], [30, "30_days"], [8, "30_days"], [7, "7_days"], [1, "7_days"],
        [0, "due"], [-6, "due"], [-7, "overdue_1"], [-13, "overdue_1"], [-14, "overdue_2"],
      ];
      for (const [days, want] of cases) assert.equal(reviewMilestone(days), want, `${days} days`);
    });

    await check("a new policy is reviewed yearly, from when it is first published", async () => {
      const id = parse(
        await as(acmeAdmin, () =>
          admin.createPolicy({ title: "Data Retention", categoryId: categoryId("Data Protection") }),
        ),
      )._id;
      const before = await as(acmeAdmin, () => Policy.findById(id).lean());
      assert.equal(before.reviewIntervalMonths, 12);
      assert.equal(before.nextReviewDate, null);

      const draft = await insertDraft(acmeAdmin, id);
      await as(acmeAdmin, () => admin.publishPolicyVersion(String(draft._id)));
      const after = await as(acmeAdmin, () => Policy.findById(id).lean());
      assert.equal(dayKey(after.nextReviewDate), dayKey(addMonthsToDay(today, 12)));
      const reviews = await as(acmeAdmin, () => PolicyReview.find({ policyId: id }).lean());
      assert.deepEqual(reviews.map((r) => [r.outcome, r.versionNumber]), [["new-version", 1]]);
    });

    await check("only a published policy can be marked as reviewed", async () => {
      const id = parse(
        await as(acmeAdmin, () =>
          admin.createPolicy({ title: "Unpublished", categoryId: categoryId("IT") }),
        ),
      )._id;
      const res = await as(acmeAdmin, () => admin.markPolicyReviewed(id, {}));
      assert.equal(res.success, false);
      await as(acmeAdmin, () => admin.deletePolicy(id));
    });

    await check("marking reviewed restarts the clock and is kept in the history", async () => {
      await as(acmeAdmin, () => admin.setPolicyArchived(fire, false));
      await as(acmeAdmin, () =>
        Policy.updateOne({ _id: fire }, { nextReviewDate: new Date(today.getTime() - 3 * DAY) }),
      );
      const res = await as(acmeAdmin, () =>
        admin.markPolicyReviewed(fire, { note: "Checked against the new risk assessment." }),
      );
      assert.equal(res.success, true, res.message);
      const policy = await loadFire();
      assert.equal(dayKey(policy.nextReviewDate), dayKey(addMonthsToDay(today, 12)));
      assert.equal(policy.lastReviewedByName, acmeAdmin.name);

      const [latest] = await as(acmeAdmin, () =>
        PolicyReview.find({ policyId: fire }).sort({ reviewedAt: -1 }).limit(1).lean(),
      );
      assert.equal(latest.outcome, "no-change");
      assert.equal(latest.note, "Checked against the new risk assessment.");
      assert.equal(dayKey(latest.dueDate), dayKey(new Date(today.getTime() - 3 * DAY)));
    });

    await check("a review date in the past is refused; an empty one schedules nothing", async () => {
      const past = await as(acmeAdmin, () =>
        admin.markPolicyReviewed(fire, { nextReviewDate: dayKey(today) }),
      );
      assert.equal(past.success, false);

      const none = await as(acmeAdmin, () => admin.markPolicyReviewed(fire, { nextReviewDate: "" }));
      assert.equal(none.success, true, none.message);
      assert.match(none.message, /No further review/);
      assert.equal((await loadFire()).nextReviewDate, null);
    });

    await check("changing the interval works the date out from the last review", async () => {
      const res = await as(acmeAdmin, () =>
        admin.updatePolicyReviewSchedule(fire, { intervalMonths: 6 }),
      );
      assert.equal(res.success, true, res.message);
      const policy = await loadFire();
      assert.equal(policy.reviewIntervalMonths, 6);
      assert.equal(
        dayKey(policy.nextReviewDate),
        dayKey(addMonthsToDay(getWorkingDate(policy.lastReviewedAt), 6)),
      );
    });

    await check("switching off regular review keeps the date already booked", async () => {
      const booked = (await loadFire()).nextReviewDate;
      await as(acmeAdmin, () => admin.updatePolicyReviewSchedule(fire, { intervalMonths: null }));
      const policy = await loadFire();
      assert.equal(policy.reviewIntervalMonths, null);
      assert.equal(dayKey(policy.nextReviewDate), dayKey(booked));
      await as(acmeAdmin, () => admin.updatePolicyReviewSchedule(fire, { intervalMonths: 12 }));
    });

    /* ------------------------------------------------- review reminders */

    const sent = [];
    const fakeSend = async (mail) => {
      sent.push(mail);
      return { success: true };
    };
    const dueIn = (days) =>
      as(acmeAdmin, () =>
        Policy.updateOne(
          { _id: fire },
          { nextReviewDate: new Date(today.getTime() + days * DAY), reviewRemindersSent: [] },
        ),
      );
    const fireMail = () => sent.filter((m) => m.html.includes(`/admin/policies/${fire}`));

    await check("the library and dashboard list what is due, with days counted on the server", async () => {
      await dueIn(-2);
      const rows = parse(await as(acmeAdmin, () => admin.getPolicies({ review: "due" })));
      assert.deepEqual(rows.map((r) => r.title), ["Fire Evacuation"]);
      assert.equal(rows[0].daysUntilReview, -2);
      assert(!("reviewRemindersSent" in rows[0]), "reminder bookkeeping leaked to the list");

      const due = parse(await as(acmeAdmin, () => admin.getPolicyReviewsDue()));
      assert.equal(due.total, 1);
      const none = parse(await as(acmeUser, () => admin.getPolicyReviewsDue()));
      assert.equal(none.total, 0);
    });

    await check("30 days out, the owner is reminded once, however many runs", async () => {
      await dueIn(20);
      sent.length = 0;
      const first = await runPolicyReviewJob({ send: fakeSend });
      await runPolicyReviewJob({ send: fakeSend });
      assert.equal(fireMail().length, 1, JSON.stringify(first));
      const [mail] = fireMail();
      assert.equal(mail.to, "admin@acme.test");
      assert.equal(mail.tenantId, A);
      assert.match(mail.subject, /^Policy review due .*: Fire Evacuation$/);
      assert.match(mail.html, /in 20 days/);
    });

    await check("two runs at the same moment still send it once", async () => {
      await dueIn(5);
      sent.length = 0;
      await Promise.all([
        runPolicyReviewJob({ send: fakeSend }),
        runPolicyReviewJob({ send: fakeSend }),
      ]);
      assert.equal(fireMail().length, 1);
    });

    await check("a failed send is tried again on the next run", async () => {
      await dueIn(0);
      sent.length = 0;
      const failing = async (mail) => {
        sent.push(mail);
        return { success: false, message: "SMTP down" };
      };
      await runPolicyReviewJob({ send: failing });
      assert.equal((await loadFire()).reviewRemindersSent.length, 0, "claim not given back");
      await runPolicyReviewJob({ send: fakeSend });
      assert.equal(fireMail().length, 2);
      assert.match(fireMail()[1].subject, /due today/);
    });

    await check("overdue: one reminder per week, picked up after a missed day", async () => {
      await dueIn(-8);
      sent.length = 0;
      await runPolicyReviewJob({ send: fakeSend });
      await runPolicyReviewJob({ send: fakeSend, now: new Date(Date.now() + 3 * DAY) });
      assert.equal(fireMail().length, 1, "one per week, not per day");
      await runPolicyReviewJob({ send: fakeSend, now: new Date(Date.now() + 6 * DAY) });
      assert.equal(fireMail().length, 2, "the second week's reminder");
      assert.match(fireMail()[1].html, /14 days overdue/);
    });

    await check("reviewing it stops the reminders", async () => {
      await as(acmeAdmin, () => admin.markPolicyReviewed(fire, {}));
      sent.length = 0;
      await runPolicyReviewJob({ send: fakeSend });
      assert.equal(fireMail().length, 0);
      assert.equal((await loadFire()).reviewRemindersSent.length, 0);
    });

    await check("with no owner and no HR mailbox, nothing is sent and the gap is logged", async () => {
      await as(acmeAdmin, () => Policy.updateOne({ _id: fire }, { ownerId: null }));
      await dueIn(3);
      sent.length = 0;
      await runPolicyReviewJob({ send: fakeSend });
      assert.equal(fireMail().length, 0);
      const logged = await db.collection("auditlogs").findOne({
        action: "Policy.reviewReminder",
        status: "failure",
        errorMessage: "No recipient",
      });
      assert(logged, "no audit entry for the missing recipient");
      await as(acmeAdmin, () =>
        Policy.updateOne({ _id: fire }, { ownerId: byEmail["admin@acme.test"]._id }),
      );
    });

    await check("a title is escaped in the email", async () => {
      await as(acmeAdmin, () =>
        Policy.updateOne({ _id: fire }, { title: "Fire <b>Evacuation</b> & Assembly" }),
      );
      await dueIn(10);
      sent.length = 0;
      await runPolicyReviewJob({ send: fakeSend });
      const [mail] = fireMail();
      assert(mail, "no reminder sent");
      assert(mail.html.includes("Fire &lt;b&gt;Evacuation&lt;/b&gt; &amp; Assembly"), mail.html);
      await as(acmeAdmin, () => Policy.updateOne({ _id: fire }, { title: "Fire Evacuation" }));
    });

    await check("archived policies and companies without the module are not reminded", async () => {
      await dueIn(2);
      await as(acmeAdmin, () => admin.setPolicyArchived(fire, true));
      sent.length = 0;
      await runPolicyReviewJob({ send: fakeSend });
      assert.equal(fireMail().length, 0, "archived policy reminded");

      await as(acmeAdmin, () => admin.setPolicyArchived(fire, false));
      await db.collection("companies").updateOne(
        { _id: acme._id },
        { $set: { "features.policies": false } },
      );
      try {
        await runPolicyReviewJob({ send: fakeSend });
        assert.equal(fireMail().length, 0, "reminded with the module off");
      } finally {
        await db.collection("companies").updateOne(
          { _id: acme._id },
          { $unset: { "features.policies": "" } },
        );
      }
      await runPolicyReviewJob({ send: fakeSend });
      assert.equal(fireMail().length, 1, "not reminded once the module was back");
    });
  } finally {
    // Leave the fixtures as they were found.
    await db.collection("rolebaseds").updateMany(
      {},
      { $pull: { permissions: "/admin/policies" } },
    );
    await db.collection("roletypes").deleteOne({ _id: financeDept });
    await db.collection("officeemployes").deleteOne({ _id: financePerson });
    for (const name of ["policies", "policyversions", "policycategories", "policyreviews"]) {
      await db.collection(name).deleteMany({ tenantId: { $in: [acme._id, beta._id] } });
    }
    await db.collection("auditlogs").deleteMany({ module: "Policy" });
    await mongoose.disconnect();
  }

  let failed = 0;
  for (const [status, name] of results) {
    if (status === "FAIL") failed++;
    console.log(`${status === "pass" ? "ok  " : "FAIL"} ${name}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
