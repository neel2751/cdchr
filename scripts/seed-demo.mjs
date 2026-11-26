/**
 * Demo companies to show customers — one login, four companies.
 *
 * One owner email runs four made-up companies, one for each kind of business
 * the app is set up for, so a sales demo can switch between them from the
 * sidebar and show each in its own words:
 *
 *   Northgate Construction       construction — sites, site crews, day-by-day
 *                                assignments, CIS pay
 *   The Olive Table              restaurant — branches and agency staff
 *   The Olive Table Manchester   restaurant — a second company of the same
 *                                owner, on the same bill (extra-company price)
 *   Bright Minds Tuition         tuition — classes, students with guardians,
 *                                ongoing enrolments
 *
 * Each has office staff and departments, its places, its people, two weeks of
 * attendance up to today (some people in now, some on a break, some gone
 * home), leave balances and requests, and announcements. All four are on a
 * package, billed together in one account, so Plan & Billing shows real
 * numbers.
 *
 * THEY ARE DEMO COMPANIES (lib/tenantAccess.js): view-only for everybody,
 * never billed, and no reminder emails go out for them. The demo login skips
 * two-factor setup only because every company it can reach is a demo — add it
 * to a real company and two-factor is required again.
 *
 * SAFE ON A LIVE DATABASE:
 *   - every row it writes carries one of the four demo companies' tenantId;
 *     nothing of any real company is read or written;
 *   - it refuses an owner email that belongs to anyone who is not already
 *     this demo's owner, and a workspace address held by a real company;
 *   - --remove deletes the demo companies and every row carrying their
 *     tenantId (including anything written while they were shown).
 *
 * Dates are relative to today, so the attendance goes stale: run --apply
 * again before a demo (or daily from cron) to bring it up to date. Re-running
 * rebuilds the sample data; the companies keep their ids and addresses.
 *
 * Usage (on the server, from the app's folder, with its .env):
 *   node scripts/seed-demo.mjs                                    # what it would do
 *   node scripts/seed-demo.mjs --apply --password='Choose-One-1'  # create / refresh
 *   node scripts/seed-demo.mjs --apply --email=demo@yourco.com --password=...
 *   node scripts/seed-demo.mjs --remove                           # delete it all
 *
 *   --email=…     the demo login (default demo@example.com)
 *   --password=…  its password; without it a random one is made and printed
 *   --name=…      the owner's name (default Alex Morgan)
 *   --editable    leave the companies changeable (not demo) — to tweak the
 *                 sample data by hand. The Access tab's switch does the same.
 *
 * Talks to the driver directly, so it is not subject to TENANT_ENFORCEMENT.
 */
import crypto from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { industryTemplate } from "../data/terminology.js";
import { featuresForPreset } from "../data/features.js";

dotenv.config();

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = "") => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = flag("apply");
const REMOVE = flag("remove");
const EDITABLE = flag("editable");
const OWNER_EMAIL = option("email", "demo@example.com").trim().toLowerCase();
const OWNER_NAME = option("name", "Alex Morgan").trim();
const GIVEN_PASSWORD = option("password");

const MARKER = "demo";
const DAY = 86400000;

/* ------------------------------------------------------------- the cast */

/**
 * The four companies. `places` become sites / branches / classes; `office`
 * are office staff (title, department, manages a place?); `people` describes
 * the site workers / agency staff / students made for each place.
 */
const COMPANIES = [
  {
    key: "construction",
    name: "Northgate Construction",
    slug: "demo-construction",
    industry: "construction",
    plan: "workforce",
    domain: "northgate.example",
    description: "Demo company — a building contractor with four live sites.",
    departments: ["Management", "Operations", "Site Management", "Finance", "HR"],
    office: [
      ["Priya Shah", "HR Manager", "HR", { admin: true }],
      ["Tom Bradley", "Operations Director", "Operations", { admin: true }],
      ["Callum Reid", "Site Manager", "Site Management", { manages: [0, 1] }],
      ["Grace Okafor", "Site Manager", "Site Management", { manages: [2, 3] }],
      ["Hannah Lewis", "Quantity Surveyor", "Operations"],
      ["Marcus Bell", "Accountant", "Finance"],
      ["Sophie Turner", "Office Administrator", "Operations"],
      ["Daniel Hughes", "Health & Safety Officer", "Operations"],
      ["Aisha Rahman", "Payroll Assistant", "Finance"],
    ],
    places: [
      ["Riverside Apartments", "14 Wharf Road, Leeds LS1 4BR", "Residential", 1850000],
      ["Kingsway Retail Park", "Kingsway, Wakefield WF1 2SP", "Commercial", 3200000],
      ["Oakfield School Extension", "Oakfield Lane, Bradford BD9 6QL", "Other", 940000],
      ["Harbour View Offices", "2 Harbour Street, Hull HU1 1RB", "Commercial", 2150000],
    ],
    perPlace: 7,
    roles: ["Bricklayer", "Carpenter", "Electrician", "Plumber", "Labourer", "Scaffolder", "Plasterer", "Groundworker"],
    pay: { payType: "Daily", min: 140, max: 240, cis: 20, paymentType: "Weekly" },
    hours: { in: "07:30", out: "16:30", break: ["12:00", "12:30"] },
    workDays: [1, 2, 3, 4, 5, 6],
    announcements: [
      ["Site induction refresher — Monday 7am", "All site crews: the quarterly safety induction refresher runs at each site gate at 7am on Monday. Bring your CSCS card.", "safety", "important"],
      ["Christmas shutdown dates", "Sites close from 20 December and reopen on 5 January. Please book any remaining annual leave before the shutdown.", "hr", "normal"],
      ["New timesheet sign-off", "Site managers now approve timesheets in the app every Friday by 3pm, so pay runs on time.", "general", "normal"],
    ],
  },
  {
    key: "restaurant",
    name: "The Olive Table",
    slug: "demo-restaurant",
    industry: "restaurant",
    plan: "essentials",
    domain: "olivetable.example",
    description: "Demo company — a restaurant group with three London branches.",
    departments: ["Management", "Operations", "Kitchen", "Front of House", "HR"],
    office: [
      ["Elena Rossi", "Operations Manager", "Operations", { admin: true }],
      ["James Carter", "Branch Manager", "Front of House", { manages: [0] }],
      ["Fatima Begum", "Branch Manager", "Front of House", { manages: [1] }],
      ["Luca Bianchi", "Branch Manager", "Front of House", { manages: [2] }],
      ["Chloe Evans", "HR Coordinator", "HR"],
      ["Oliver Grant", "Head Chef", "Kitchen"],
    ],
    places: [
      ["Covent Garden", "21 Floral Street, London WC2E 9DP", "Commercial", null],
      ["Shoreditch", "88 Curtain Road, London EC2A 3AA", "Commercial", null],
      ["Canary Wharf", "5 Cabot Square, London E14 4QS", "Commercial", null],
    ],
    perPlace: 7,
    roles: ["Chef de Partie", "Sous Chef", "Waiter", "Bartender", "Kitchen Porter", "Host", "Barista"],
    pay: { payType: "Hourly", min: 11, max: 17, paymentType: "Weekly" },
    hours: { in: "11:00", out: "20:00", break: ["15:00", "15:30"] },
    workDays: [0, 1, 2, 3, 4, 5, 6],
    announcements: [
      ["Winter menu tasting — Tuesday 3pm", "All kitchen teams: the new winter menu tasting is at Covent Garden on Tuesday at 3pm.", "event", "normal"],
      ["Allergen training due", "Everyone serving food must complete the allergen refresher by the end of the month.", "safety", "important"],
    ],
  },
  {
    key: "restaurant-mcr",
    name: "The Olive Table Manchester",
    slug: "demo-restaurant-mcr",
    industry: "restaurant",
    plan: "essentials",
    domain: "olivetable-mcr.example",
    description: "Demo company — the same owner's second restaurant company, on the same bill.",
    departments: ["Management", "Front of House", "Kitchen"],
    office: [
      ["Ryan Walsh", "General Manager", "Management", { admin: true, manages: [0, 1] }],
      ["Zara Ahmed", "Assistant Manager", "Front of House"],
    ],
    places: [
      ["Spinningfields", "3 Hardman Street, Manchester M3 3HF", "Commercial", null],
      ["Northern Quarter", "45 Oldham Street, Manchester M1 1JG", "Commercial", null],
    ],
    perPlace: 5,
    roles: ["Chef de Partie", "Waiter", "Bartender", "Kitchen Porter", "Host"],
    pay: { payType: "Hourly", min: 11, max: 16, paymentType: "Weekly" },
    hours: { in: "12:00", out: "21:00", break: ["16:00", "16:30"] },
    workDays: [0, 2, 3, 4, 5, 6],
    announcements: [
      ["Welcome to the Manchester team", "Our Manchester branches now use the same app as London — clock in and see your shifts here.", "general", "normal"],
    ],
  },
  {
    key: "tuition",
    name: "Bright Minds Tuition",
    slug: "demo-tuition",
    industry: "tuition",
    plan: "essentials",
    domain: "brightminds.example",
    description: "Demo company — a tuition centre with weekly classes.",
    departments: ["Management", "Teaching", "Administration"],
    office: [
      ["Dr Helen Price", "Head of Centre", "Management", { admin: true }],
      ["Samuel Osei", "Maths Teacher", "Teaching", { manages: [0, 3] }],
      ["Laura Kent", "English Teacher", "Teaching", { manages: [1] }],
      ["Arjun Patel", "Science Teacher", "Teaching", { manages: [2] }],
      ["Megan Price", "Centre Administrator", "Administration"],
    ],
    places: [
      ["Year 6 Maths", "Room 1, 10 College Road, Birmingham B15 2TT", "Other", null, [1, 3]],
      ["GCSE English", "Room 2, 10 College Road, Birmingham B15 2TT", "Other", null, [2, 4]],
      ["A-Level Chemistry", "Lab, 10 College Road, Birmingham B15 2TT", "Other", null, [1, 4]],
      ["11+ Preparation", "Room 1, 10 College Road, Birmingham B15 2TT", "Other", null, [6]],
    ],
    perPlace: 8,
    students: true,
    hours: { in: "16:00", out: "18:00" },
    announcements: [
      ["Mock exam week", "GCSE and A-Level students sit mock papers in class the week after half term. Please bring a calculator.", "event", "important"],
      ["Parents' evening", "Parents' evening is on Thursday from 5pm. Book a slot with your child's class teacher.", "general", "normal"],
    ],
  },
];

const FIRST = ["Oliver", "Amelia", "Noah", "Isla", "Mohammed", "Ava", "Leo", "Mia", "Arthur", "Ivy", "Harry", "Freya", "Jacob", "Lily", "Ethan", "Sofia", "Kai", "Zara", "Theo", "Maya", "Reuben", "Nadia", "Jamal", "Chen", "Tomasz", "Aleksandra", "Kwame", "Siobhan", "Ravi", "Ellie", "Femi", "Ana", "Dmitri", "Hana", "Jack", "Erin", "Yusuf", "Rosa", "Lewis", "Imogen"];
const LAST = ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Patel", "Robinson", "Wright", "Thompson", "Evans", "Walker", "Khan", "Roberts", "Green", "Hall", "Wood", "Jackson", "Clarke", "Nowak", "Mensah", "O'Brien", "Kaur", "Murphy", "Hussain", "Kowalski", "Adeyemi", "Singh"];
const YEARS = { "Year 6 Maths": ["Year 6"], "GCSE English": ["Year 10", "Year 11"], "A-Level Chemistry": ["Year 12", "Year 13"], "11+ Preparation": ["Year 5"] };
const SCHOOLS = ["St Mary's Primary", "King Edward's School", "Harborne Academy", "Lordswood Girls' School", "Queensbridge School"];
const MEDICAL = ["", "", "", "Mild asthma — inhaler in bag", "Nut allergy", ""];

/* --------------------------------------------------------------- helpers */

/** A repeatable sequence, so a refresh looks the same as the last one. */
function rng(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Today's date in the UK, at UTC midnight — how clock records store it. */
function ukToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
}

/** "2026-27" — the leave year (April to March) a date falls in. */
function leaveYearOf(date) {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** "HH:mm" plus or minus some minutes. */
function shift(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const t = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + minutes));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

const slugEmail = (name, domain) =>
  `${name.toLowerCase().replace(/^dr /, "").replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@${domain}`;

function randomPassword() {
  return `Demo-${crypto.randomBytes(6).toString("base64url")}-7a!`;
}

/* ------------------------------------------------------------------ main */

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(process.env.MONGO_DB_URL);
  const db = mongoose.connection.db;
  console.log(`Database: ${db.databaseName}`);

  const existing = await db
    .collection("companies")
    .find({ seedMarker: MARKER })
    .toArray();
  const existingIds = existing.map((c) => c._id);

  if (REMOVE) {
    if (!existing.length) {
      console.log("No demo companies here. Nothing to remove.");
      return;
    }
    await wipe(db, existingIds);
    await db.collection("tenantmemberships").deleteMany({ tenantId: { $in: existingIds } });
    await db.collection("billingaccounts").deleteMany({ seedMarker: MARKER });
    await db.collection("companies").deleteMany({ _id: { $in: existingIds } });
    console.log(`Removed ${existing.length} demo companies and everything in them.`);
    return;
  }

  // Refuse to touch anything real.
  const problems = await safetyProblems(db, existingIds);
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("Stopping. Nothing was written.");
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log(
      existing.length
        ? `${existing.length} demo companies exist. --apply refreshes their sample data.`
        : "No demo companies yet. --apply creates them."
    );
    console.log(`Login would be: ${OWNER_EMAIL}`);
    for (const c of COMPANIES) console.log(`  ${c.name}  (${c.slug}, ${c.industry})`);
    console.log("Dry run. Nothing written.");
    return;
  }

  const password = GIVEN_PASSWORD || randomPassword();
  if (password.length < 8) {
    console.error("Use a password of at least 8 characters.");
    process.exitCode = 1;
    return;
  }
  const ownerHash = await bcrypt.hash(password, 10);
  // Everybody else's: a password nobody knows. They are not for signing in.
  const nobodyHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);

  const now = new Date();
  const today = ukToday();

  // The companies first, keeping their ids across refreshes.
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const ids = {};
  for (const spec of COMPANIES) {
    const template = industryTemplate(spec.industry);
    const prior = bySlug.get(spec.slug);
    const _id = prior?._id || new mongoose.Types.ObjectId();
    ids[spec.key] = _id;
    await db.collection("companies").updateOne(
      { _id },
      {
        $set: {
          name: spec.name,
          description: spec.description,
          slug: spec.slug,
          seedMarker: MARKER,
          status: "active",
          industry: template.key,
          features: featuresForPreset(template.featurePreset) || {},
          domains: [],
          isActive: true,
          delete: false,
          // The checklist is for a new customer setting up; a demo is set up.
          setupProgress: { hidden: true },
          updatedAt: now,
        },
        $setOnInsert: { createdAt: new Date(today.getTime() - 120 * DAY) },
      },
      { upsert: true }
    );
  }
  const allIds = Object.values(ids);

  // Rebuild: clear every row of theirs, then write it fresh.
  await wipe(db, allIds);

  // One customer account for the four, the construction company as main.
  const account = await db.collection("billingaccounts").findOneAndUpdate(
    { seedMarker: MARKER },
    {
      $set: {
        name: "Morgan Group (demo)",
        primaryCompanyId: ids.construction,
        paymentMethod: "invoice",
        notes: "Demo account made by scripts/seed-demo.mjs. Never billed.",
        seedMarker: MARKER,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, createdBy: "demo" },
    },
    { upsert: true, returnDocument: "after" }
  );
  const accountId = account?._id || account?.value?._id;

  const summary = [];
  for (const spec of COMPANIES) {
    const tenantId = ids[spec.key];
    const made = await seedCompany(db, spec, {
      tenantId,
      today,
      now,
      ownerHash,
      nobodyHash,
      isDefault: spec.key === "construction",
    });
    await db.collection("companies").updateOne(
      { _id: tenantId },
      {
        $set: {
          billing: {
            plan: spec.plan,
            cycle: "monthly",
            planAppliedAt: now,
            planAppliedBy: "demo",
            overageMode: "charge",
            accountId,
            extraCompany: spec.key !== "construction",
            ...(EDITABLE ? {} : { demo: true }),
          },
        },
      }
    );
    summary.push([spec, made]);
  }

  console.log("\nDemo companies are ready.\n");
  console.log(`  Sign in:   ${OWNER_EMAIL}`);
  console.log(`  Password:  ${password}${GIVEN_PASSWORD ? "" : "   (random — not stored anywhere else)"}`);
  const root = process.env.PLATFORM_ROOT_DOMAIN;
  console.log("");
  for (const [spec, made] of summary) {
    console.log(
      `  ${spec.name.padEnd(28)} ${String(made.office).padStart(2)} office, ` +
        `${String(made.people).padStart(2)} ${spec.students ? "students" : "workers "}, ` +
        `${made.places} ${industryTemplate(spec.industry).terms.sites.toLowerCase()}` +
        (root ? `   https://${spec.slug}.${root}` : "")
    );
  }
  console.log(
    EDITABLE
      ? "\n  --editable: these can be changed. Switch them back to demo on each company's Access tab."
      : "\n  View-only for everyone, never billed, no reminder emails."
  );
  console.log("  Switch company from the sidebar. Refresh the data with --apply; remove it with --remove.");
}

/** Every row carrying one of these tenant ids, in every collection. */
async function wipe(db, tenantIds) {
  if (!tenantIds.length) return;
  for (const { name } of await db.listCollections().toArray()) {
    if (name.startsWith("system.") || name === "companies") continue;
    await db.collection(name).deleteMany({ tenantId: { $in: tenantIds } });
  }
}

/** Reasons not to go ahead: the login or an address belongs to somebody real. */
async function safetyProblems(db, demoIds) {
  const problems = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(OWNER_EMAIL)) {
    problems.push(`"${OWNER_EMAIL}" is not an email address`);
  }
  const notDemo = { tenantId: { $nin: demoIds } };
  const rx = new RegExp(`^${OWNER_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  for (const [collection, extra] of [
    ["officeemployes", notDemo],
    ["employes", notDemo],
    ["officeusers", {}],
    ["platformusers", {}],
  ]) {
    if (await db.collection(collection).findOne({ email: rx, ...extra })) {
      problems.push(`${OWNER_EMAIL} already belongs to a real account (${collection}). Use --email= with an address only the demo uses.`);
    }
  }
  if (await db.collection("tenantmemberships").findOne({ email: OWNER_EMAIL, tenantId: { $nin: demoIds } })) {
    problems.push(`${OWNER_EMAIL} is a member of a real company. Use --email= with an address only the demo uses.`);
  }
  const taken = await db
    .collection("companies")
    .find({ slug: { $in: COMPANIES.map((c) => c.slug) }, seedMarker: { $ne: MARKER } })
    .toArray();
  for (const c of taken) problems.push(`The address "${c.slug}" belongs to a real company (${c.name}).`);
  return problems;
}

/* --------------------------------------------------------- one company */

async function seedCompany(db, spec, { tenantId, today, now, ownerHash, nobodyHash, isDefault }) {
  const random = rng(spec.key);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (min, max) => Math.round(min + random() * (max - min));
  const insert = (collection, docs) =>
    docs.length
      ? db.collection(collection).insertMany(
          docs.map((d) => ({ tenantId, createdAt: now, updatedAt: now, ...d }))
        )
      : null;
  const id = () => new mongoose.Types.ObjectId();
  const leaveYear = leaveYearOf(today);

  // Departments.
  const departments = Object.fromEntries(spec.departments.map((d) => [d, id()]));
  await insert(
    "roletypes",
    spec.departments.map((d) => ({
      _id: departments[d],
      roleTitle: d,
      roleDescription: `${d} team`,
      isActive: true,
      delete: false,
    }))
  );

  // Office staff, the owner first.
  const phone = (n) => Number(`7700900${String(n % 1000).padStart(3, "0")}`);
  const ownerId = id();
  const office = [
    {
      _id: ownerId,
      name: OWNER_NAME,
      email: OWNER_EMAIL,
      password: ownerHash,
      roleType: "Managing Director",
      department: departments.Management,
      isAdmin: true,
      isSuperAdmin: true,
      joined: 900,
    },
    ...spec.office.map(([name, title, dept, extra = {}], i) => ({
      _id: id(),
      name,
      email: slugEmail(name, spec.domain),
      password: nobodyHash,
      roleType: title,
      department: departments[dept] || departments.Management,
      isAdmin: !!extra.admin,
      isSuperAdmin: false,
      manages: extra.manages || [],
      joined: 120 + i * 90,
    })),
  ];
  await insert(
    "officeemployes",
    office.map((p, i) => ({
      _id: p._id,
      name: p.name,
      email: p.email,
      phoneNumber: phone(100 + i),
      password: p.password,
      roleType: p.roleType,
      department: p.department,
      company: tenantId,
      employeId: `EMP${String(i + 1).padStart(3, "0")}`,
      dateOfBirth: new Date(Date.UTC(1975 + (i * 3) % 25, i % 12, 3 + i)),
      immigrationType: "British",
      employeType: "Full-Time",
      dayPerWeek: 5,
      weeklyHourType: "fixed",
      isActive: true,
      isAdmin: p.isAdmin,
      isSuperAdmin: p.isSuperAdmin,
      countryOfWork: "United Kingdom",
      isShowenInWeeklyTimesheet: true,
      address: `${10 + i} Station Road`,
      city: "Leeds",
      postCode: "LS1 1AA",
      country: "United Kingdom",
      joinDate: new Date(today.getTime() - p.joined * DAY),
      emergencyName: "Next of kin",
      emergencyRelation: "Partner",
      emergencyPhoneNumber: phone(500 + i),
      mustChangePassword: false,
      rightToWorkChecks: [],
      carryForwardOverrides: [],
      delete: false,
    }))
  );

  // The owner's membership: how one login reaches all four.
  await db.collection("tenantmemberships").updateOne(
    { email: OWNER_EMAIL, tenantId },
    {
      $set: {
        userId: ownerId,
        userModel: "OfficeEmploye",
        email: OWNER_EMAIL,
        tenantId,
        role: "superAdmin",
        isDefault,
        isActive: true,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  // Places, and a clock-in location for each, plus the head office.
  const officeLocation = id();
  const places = spec.places.map(([siteName, siteAddress, siteType, budget, days]) => ({
    _id: id(),
    locationId: id(),
    siteName,
    siteAddress,
    siteType,
    budget,
    days,
  }));
  await insert(
    "projectsites",
    places.map((p, i) => ({
      _id: p._id,
      siteName: p.siteName,
      siteAddress: p.siteAddress,
      siteType: p.siteType,
      siteDescription: spec.students ? `Weekly class at ${p.siteAddress}` : `${p.siteName}, ${p.siteAddress}`,
      status: "Active",
      isActive: true,
      siteDelete: false,
      startDate: new Date(today.getTime() - (200 - i * 30) * DAY),
      endDate: new Date(today.getTime() + (240 + i * 45) * DAY),
      ...(p.budget ? { budget: p.budget } : {}),
    }))
  );
  await insert("clocklocations", [
    {
      _id: officeLocation,
      name: "Head Office",
      kind: "office",
      projectSiteId: null,
      isDefault: true,
      isActive: true,
      requireAll: false,
      requirePositionForTaps: false,
    },
    ...places.map((p) => ({
      _id: p.locationId,
      name: p.siteName,
      kind: "site",
      projectSiteId: p._id,
      isDefault: false,
      isActive: true,
      requireAll: false,
      requirePositionForTaps: false,
    })),
  ]);

  // Who manages which place.
  const managers = office.filter((p) => p.manages?.length);
  await insert(
    "assignprojects",
    managers.flatMap((m) =>
      m.manages.map((i) => ({
        loginSiteId: `demo-${m._id}-${i}`,
        roleId: m._id,
        projectSiteID: places[i]._id,
        startDate: new Date(today.getTime() - 90 * DAY),
        endDate: null,
        isActive: true,
        isVerified: true,
        isDelete: false,
      }))
    )
  );

  // The people at the places.
  let n = 0;
  const people = [];
  for (const place of places) {
    for (let k = 0; k < spec.perPlace; k++) {
      n += 1;
      const firstName = FIRST[(n * 7 + spec.key.length) % FIRST.length];
      const lastName = LAST[(n * 11 + spec.key.length * 3) % LAST.length];
      const base = {
        _id: id(),
        firstName,
        lastName,
        email: `${firstName}.${lastName}.${n}@${spec.domain}`.toLowerCase().replace(/'/g, ""),
        password: nobodyHash,
        phone: phone(200 + n),
        eAddress: {
          address: `${between(1, 140)} ${pick(["High Street", "Church Lane", "Park Road", "Mill Lane", "Victoria Road"])}`,
          city: pick(["Leeds", "London", "Manchester", "Birmingham"]),
          postCode: pick(["LS6 2AB", "E2 7DJ", "M14 5RT", "B17 9QS"]),
          country: "United Kingdom",
        },
        projectSite: place._id,
        startDate: new Date(today.getTime() - between(30, 600) * DAY),
        immigrationType: "British",
        emergencyName: spec.students ? `${pick(FIRST)} ${lastName}` : `${pick(FIRST)} ${pick(LAST)}`,
        emergencyRelation: spec.students ? "Parent" : pick(["Partner", "Parent", "Sibling"]),
        emergencyPhoneNumber: phone(700 + n),
        isActive: true,
        isVerfied: true,
        isAdmin: false,
        rightToWorkChecks: [],
        delete: false,
      };
      const person = spec.students
        ? {
            ...base,
            employeType: "Student",
            guardianName: base.emergencyName,
            guardianRelation: pick(["Mother", "Father", "Guardian"]),
            guardianPhone: `07700 900${String(700 + n).padStart(3, "0")}`,
            guardianEmail: `parent.${lastName}.${n}@${spec.domain}`.toLowerCase().replace(/'/g, ""),
            schoolName: pick(SCHOOLS),
            yearGroup: pick(YEARS[place.siteName] || ["Year 9"]),
            medicalNotes: pick(MEDICAL),
            dateOfBirth: new Date(Date.UTC(2010 + (n % 8), n % 12, 1 + (n % 27))),
          }
        : {
            ...base,
            employeType: "Full Time",
            employeRole: pick(spec.roles),
            payType: spec.pay.payType,
            paymentType: spec.pay.paymentType,
            payRate: between(spec.pay.min, spec.pay.max),
            ...(spec.pay.cis ? { cisDeduction: spec.pay.cis, utr: String(1000000000 + n * 7919) } : {}),
            employeNI: `QQ${String(100000 + n * 37).slice(-6)}C`,
            dateOfBirth: new Date(Date.UTC(1970 + (n % 30), n % 12, 1 + (n % 27))),
          };
      people.push({ ...person, place });
    }
  }
  // Two who have left, so "previous" lists are not empty.
  people.slice(-2).forEach((p) => {
    p.isActive = false;
    p.endDate = new Date(today.getTime() - 20 * DAY);
    p.statusDate = p.endDate;
  });
  await insert("employes", people.map(({ place, ...p }) => p));
  const current = people.filter((p) => p.isActive);

  // Leave, planned before attendance so nobody clocks in on a day off:
  // someone off today, a sick day last week, a holiday last week, and
  // requests waiting for an answer.
  const weekday = (from, count) => {
    const out = [];
    let d = new Date(from);
    while (out.length < count) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(new Date(d));
      d = new Date(d.getTime() + DAY);
    }
    return out;
  };
  const staff = office.slice(1);
  const leavePlan = [
    [staff[1], "Annual Leave", weekday(today, 2), "Approved", "Long weekend", 14],
    [staff[0], "Annual Leave", weekday(new Date(today.getTime() + 21 * DAY), 5), "Pending", "Holiday abroad", 2],
    [staff[3], "Sick Leave", weekday(new Date(today.getTime() - 9 * DAY), 1), "Approved", "Unwell", 9],
    [staff[4], "Annual Leave", weekday(new Date(today.getTime() + 10 * DAY), 1), "Pending", "Appointment", 1],
    [staff[2], "Unpaid Leave", weekday(new Date(today.getTime() + 35 * DAY), 2), "Rejected", "Extra days off", 6],
    [staff[5], "Annual Leave", weekday(new Date(today.getTime() - 7 * DAY), 2), "Approved", "Family visit", 20],
  ].filter(([person]) => person);
  const offDays = new Set(
    leavePlan
      .filter(([, , , status]) => status === "Approved")
      .flatMap(([person, , dates]) => dates.map((d) => `${person._id}|${+d}`))
  );

  // Assignments and attendance, for the last two weeks and today.
  const days = [];
  for (let back = 14; back >= 0; back--) days.push(new Date(today.getTime() - back * DAY));
  const assignments = [];
  const clocks = [];
  const standing = [];

  const record = (person, kind, place, date, isToday, r) => {
    const start = shift(spec.hours.in, Math.round((r - 0.5) * 20));
    const base = {
      employeeId: person._id,
      employeeType: kind === "office" ? "OfficeEmployee" : "Employee",
      locationType: kind === "office" ? "office" : "site",
      siteId: kind === "office" ? null : place._id,
      locationId: kind === "office" ? officeLocation : place.locationId,
      clockIn: kind === "office" ? shift("08:55", Math.round((r - 0.5) * 30)) : start,
      clockBy: "Demo",
      overtime: 0,
      date,
      isLocked: false,
      needsReview: false,
      isDeleted: false,
    };
    const end = kind === "office" ? shift("17:30", Math.round(r * 30)) : shift(spec.hours.out, Math.round((r - 0.3) * 30));
    const breaks = spec.hours.break ? [{ breakIn: spec.hours.break[0], breakOut: spec.hours.break[1] }] : [];
    if (!isToday) return { ...base, clockOut: end, breaks, status: "clocked-out" };
    // Today: most are in, a few on a break, one or two gone home.
    if (r < 0.12) return { ...base, clockOut: shift(base.clockIn, 240), breaks: [], status: "clocked-out" };
    if (r < 0.25 && spec.hours.break) {
      return { ...base, breaks: [{ breakIn: spec.hours.break[0] }], status: "on-break" };
    }
    return { ...base, breaks: [], status: "checked-in" };
  };

  if (spec.students) {
    // Enrolled from a date until further notice, on the class's days.
    for (const p of current) {
      standing.push({
        siteId: p.place._id,
        employeeId: p._id,
        startDate: p.startDate,
        endDate: null,
        days: p.place.days,
        assignedBy: ownerId,
        isDeleted: false,
      });
    }
    for (const date of days) {
      const isToday = +date === +today;
      for (const p of current) {
        if (!p.place.days.includes(date.getUTCDay())) continue;
        const r = random();
        if (r > 0.92) continue; // absent
        clocks.push(record(p, "site", p.place, date, isToday, r));
      }
    }
  } else {
    // Put on a place each working day.
    for (const date of days) {
      if (!spec.workDays.includes(date.getUTCDay())) continue;
      const isToday = +date === +today;
      for (const place of places) {
        const crew = current.filter((p) => p.place === place);
        const onToday = crew.filter(() => random() > 0.12);
        assignments.push({
          siteId: place._id,
          assignDate: date,
          assignedEmployees: onToday.map((p) => ({
            employeeId: p._id,
            assignedBy: ownerId,
            assignedAt: new Date(date.getTime() - DAY),
            isLocked: true,
          })),
        });
        for (const p of onToday) {
          const r = random();
          if (isToday && r > 0.9) continue; // assigned but not in yet
          clocks.push(record(p, "site", place, date, isToday, r));
        }
      }
    }
  }

  // Office staff on weekdays, except on a day of approved leave.
  for (const date of days) {
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const isToday = +date === +today;
    for (const p of office) {
      if (offDays.has(`${p._id}|${+date}`)) continue;
      const r = random();
      if (r > 0.95) continue;
      clocks.push(record(p, "office", null, date, isToday, r));
    }
  }
  await insert("siteassignments", assignments);
  await insert("standingassignments", standing);
  await insert("clockrecords", clocks);

  // Settings a screen would otherwise create the first time it is opened —
  // which a view-only company cannot do.
  await insert("leavesettings", [
    { leaveYearStartMonth: 4, carryForwardEnabled: false, carryForwardRules: [], configuredAt: now },
  ]);
  await insert("worksettings", [{ fixedWeeklyHours: 40, defaultDaysPerWeek: 5 }]);

  // Leave: the types, everyone's balance, and some requests.
  const types = [
    ["Annual Leave", 28, "Paid"],
    ["Sick Leave", 10, "Paid"],
    ["Unpaid Leave", 10, "Unpaid"],
  ];
  await insert(
    "leavecategories",
    types.map(([leaveType, total, paid]) => ({
      leaveType,
      total,
      isPaid: paid,
      isHide: "Show",
      isEditable: true,
      isActive: true,
      isDeleted: false,
    }))
  );

  const requests = [];
  const used = new Map();
  const request = (person, leaveType, dates, status, reason, submittedDaysAgo) => {
    const paid = leaveType !== "Unpaid Leave";
    requests.push({
      employeeId: person._id,
      leaveYear,
      leaveType,
      leaveSubmitDate: new Date(today.getTime() - submittedDaysAgo * DAY),
      leaveStatus: status,
      leaveReason: reason,
      leaveDates: dates,
      leaveBreakdown: [{ leaveType, leaveYear, leaveDays: dates.length }],
      leaveStartDate: dates[0],
      leaveEndDate: dates[dates.length - 1],
      isPaid: paid,
      leaveDays: dates.length,
      leaveTotalHours: dates.length * 8,
      submitBy: person._id,
      ...(status === "Approved"
        ? { approvedBy: ownerId, approvedDate: new Date(today.getTime() - (submittedDaysAgo - 1) * DAY) }
        : {}),
      ...(status === "Rejected" ? { rejectBy: ownerId, adminComment: "Too many people off that week" } : {}),
      isDeleted: false,
      wasExpired: false,
      addByAdmin: false,
      isHalfDay: false,
    });
    if (status === "Approved") {
      const key = `${person._id}|${leaveType}`;
      used.set(key, (used.get(key) || 0) + dates.length);
    }
  };
  for (const plan of leavePlan) request(...plan);
  await insert("leaverequests", requests);

  await insert(
    "commonleaves",
    office.map((p) => ({
      employeeId: p._id,
      leaveYear,
      leaveData: types.map(([leaveType, total, paid]) => {
        const taken = used.get(`${p._id}|${leaveType}`) || 0;
        return {
          leaveType,
          total,
          used: taken,
          remaining: total - taken,
          type: "days",
          SSP: null,
          extraType: null,
          isHide: false,
          isLock: false,
          paid: null,
          isPaid: paid === "Paid",
        };
      }),
      submitedBy: ownerId,
      submitedDate: now,
      leaveHistory: [],
    }))
  );

  // Announcements, newest first.
  await insert(
    "announcements",
    spec.announcements.map(([title, body, category, priority], i) => {
      const at = new Date(today.getTime() - (i * 4 + 1) * DAY);
      return {
        title,
        body,
        category,
        priority,
        status: "published",
        audience: { mode: "all", roles: [], departments: [], sites: [], people: [], includeField: true },
        attachments: [],
        channels: { inApp: true, email: false, push: false },
        requireAck: priority === "important",
        publishAt: null,
        expiresAt: null,
        publishedAt: at,
        createdBy: ownerId,
        createdByName: OWNER_NAME,
        recipientCount: office.length + current.length,
        isDeleted: false,
        createdAt: at,
        updatedAt: at,
      };
    })
  );

  return { office: office.length, people: current.length, places: places.length };
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
