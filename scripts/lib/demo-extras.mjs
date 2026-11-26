/**
 * The rest of a demo company (scripts/seed-demo.mjs): weekly rotas, policies,
 * profile change requests, the reception desk and its visitors, expenses,
 * employee documents and the media library — and the files behind them.
 *
 * Files are small generated PDFs, stored in the company's own folder of the
 * bucket (tenants/<companyId>/…, as the app stores them), so "open" works on
 * the documents, policies and receipts. Without storage configured the
 * records are still made and the files simply do not open.
 *
 * Raw driver, like the script that calls it.
 */
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { starterRotaCategories } from "../../lib/rotaCategories.js";
import { DEFAULT_POLICY_CATEGORIES, policyNameKey } from "../../lib/policies.js";

const DAY = 86400000;

/* ------------------------------------------------------------- files */

/** A one-page PDF saying what the document is, and that it is a sample. */
export function samplePdf(title, lines = []) {
  const ascii = (t) =>
    String(t)
      .replace(/[–—]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/([\\()])/g, "\\$1");
  const body = [
    "BT /F1 20 Tf 60 780 Td (" + ascii(title) + ") Tj ET",
    "BT /F1 10 Tf 60 758 Td (SAMPLE DOCUMENT - demo data, not a real record) Tj ET",
    ...lines.map((l, i) => `BT /F1 12 Tf 60 ${720 - i * 20} Td (${ascii(l)}) Tj ET`),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

/**
 * The bucket, or a stand-in that only measures when there is none (or
 * --no-files). Finds out once, with one small upload, rather than failing
 * file by file.
 */
export async function fileStore({ enabled }) {
  const bucket = process.env.AWS_BUCKET_NAME;
  const configured =
    enabled && bucket && process.env.AWS_ACCESS_ID && process.env.AWS_ACCESS_PORTAL_KEY;
  const client = configured
    ? new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_ID,
          secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        maxAttempts: 1,
        // An S3-compatible store (MinIO, a test double) at its own address.
        ...(process.env.AWS_ENDPOINT_URL_S3
          ? { endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: true }
          : {}),
      })
    : null;
  let live = Boolean(client);
  let uploaded = 0;
  let note = configured ? "" : enabled ? "storage is not configured" : "--no-files";

  return {
    get live() {
      return live;
    },
    get uploaded() {
      return uploaded;
    },
    get note() {
      return note;
    },
    /** Store a sample PDF at `key`; returns what a record needs. */
    async pdf(key, title, lines) {
      const bytes = samplePdf(title, lines);
      if (live) {
        try {
          await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/pdf" })
          );
          uploaded += 1;
        } catch (error) {
          live = false;
          note = `could not upload (${error?.name || error?.message}) — records made without files`;
        }
      }
      return { key, fileSize: bytes.length, fileType: "application/pdf" };
    },
    /** Remove everything under these companies' folders. */
    async clear(tenantIds) {
      if (!client) return 0;
      let removed = 0;
      try {
        for (const id of tenantIds) {
          let token;
          do {
            const page = await client.send(
              new ListObjectsV2Command({ Bucket: bucket, Prefix: `tenants/${id}/`, ContinuationToken: token })
            );
            const keys = (page.Contents || []).map((o) => ({ Key: o.Key }));
            if (keys.length) {
              await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
              removed += keys.length;
            }
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
          } while (token);
        }
      } catch (error) {
        live = false;
        note = `could not reach storage (${error?.name || error?.message}) — records made without files`;
      }
      return removed;
    },
  };
}

/* ------------------------------------------------------- the extras */

const iso = (d) => d.toISOString().slice(0, 10);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const safe = (s) => String(s).replace(/[^\w.-]+/g, "-");

/**
 * @param {object} ctx  from seedCompany: db, spec, tenantId, today, now,
 *   office (with _id, name, email, roleType, manages), ownerId, places,
 *   current (people), features, terms, offDays, files, insert, id, random
 */
export async function seedExtras(ctx) {
  const made = {};
  if (ctx.features.weeklyRota !== false) made.rotas = await rotas(ctx);
  if (ctx.features.policies !== false) made.policies = await policies(ctx);
  made.requests = await changeRequests(ctx);
  if (ctx.features.reception !== false) made.reception = await reception(ctx);
  if (ctx.features.visitors !== false) made.visitors = await visitors(ctx);
  if (ctx.features.expenses !== false) made.expenses = await expenses(ctx);
  if (ctx.features.documents !== false) made.documents = await documents(ctx);
  return made;
}

/** Shift types, and approved rotas for last week, this week and next. */
async function rotas({ insert, terms, today, office, places, offDays, ownerId, spec, now }) {
  const categories = starterRotaCategories(terms);
  await insert(
    "attendancecategories",
    categories.map((c, i) => ({
      attendanceCategoryName: c.name,
      attendanceCategoryValue: c.value,
      attendanceCategoryDescription: c.description,
      kind: c.kind,
      ...(c.startTime ? { startTime: c.startTime, endTime: c.endTime } : {}),
      sortOrder: i,
      isActive: true,
      isDeleted: false,
    }))
  );
  const [work, place, off] = categories;
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
  const weekendWork = (spec.workDays || [1, 2, 3, 4, 5]).includes(6);
  const docs = [-7, 0, 7].map((shift) => {
    const start = new Date(monday.getTime() + shift * DAY);
    return {
      weekStartDate: start,
      submitDate: new Date(start.getTime() - 3 * DAY),
      approvedBy: ownerId,
      approvedCount: 1,
      approvedDate: new Date(start.getTime() - 3 * DAY),
      approvedStatus: "Approved",
      status: "Active",
      version: 1,
      isDeleted: false,
      attendanceData: office.map((p, n) => ({
        employeeId: p._id,
        employeeName: p.name,
        schedule: [0, 1, 2, 3, 4, 5, 6].map((d) => {
          const date = new Date(start.getTime() + d * DAY);
          const day = DAYS[date.getUTCDay()];
          const entry = { date: iso(date), day };
          const weekend = day === "Sun" || (day === "Sat" && !(weekendWork && n % 3 === 0));
          if (weekend || offDays.has(`${p._id}|${+date}`)) {
            return { ...entry, category: off.value, kind: "off", label: off.name, startTime: "00:00", endTime: "00:00" };
          }
          // Managers spend two days a week at their places.
          if (p.manages?.length && (d === 1 || d === 3)) {
            const at = places[p.manages[d === 1 ? 0 : p.manages.length - 1]];
            return {
              ...entry,
              category: place.value,
              kind: "place",
              label: place.name,
              site: at.siteName,
              startTime: spec.hours?.in && spec.key !== "tuition" ? spec.hours.in : "09:00",
              endTime: spec.hours?.out && spec.key !== "tuition" ? spec.hours.out : "17:00",
            };
          }
          return { ...entry, category: work.value, kind: "work", label: work.name, startTime: "09:00", endTime: "17:00" };
        }),
      })),
      createdAt: now,
    };
  });
  await insert("weeklyrotas", docs);
  return docs.length;
}

const POLICIES = {
  common: [
    ["HR", "Employee Handbook", "How we work: hours, conduct, leave and pay.", ["Working hours and breaks", "Annual leave: 28 days including bank holidays", "Sickness: tell your manager before 9am", "Code of conduct and dress"]],
    ["Data Protection", "Data Protection and Privacy", "How we look after personal data under UK GDPR.", ["What we keep and why", "Who can see it", "How long we keep it", "Your rights"]],
    ["Fire Safety", "Fire Evacuation Procedure", "What to do when the alarm sounds.", ["Leave by the nearest exit", "Do not use lifts", "Assemble at the front car park", "Fire wardens take the register"]],
    ["IT", "Acceptable Use of IT", "Using company devices, email and the internet.", ["Lock your screen when you leave it", "No personal software", "Report lost devices straight away"]],
  ],
  construction: [["Health & Safety", "Working at Height", "Ladders, scaffolds and harnesses on site.", ["Permit before any work at height", "Inspect harnesses daily", "Scaffold tags must be green"]]],
  restaurant: [["Health & Safety", "Food Hygiene and Allergens", "Keeping food safe and customers informed.", ["Wash hands between tasks", "Label all allergens", "Fridge checks twice a day"]]],
  "restaurant-mcr": [["Health & Safety", "Food Hygiene and Allergens", "Keeping food safe and customers informed.", ["Wash hands between tasks", "Label all allergens", "Fridge checks twice a day"]]],
  tuition: [["HR", "Safeguarding Children", "Keeping every student safe.", ["DBS checks for all staff", "Report any concern to the safeguarding lead", "Never be alone with a student behind a closed door"]]],
};

/** A policy library: categories, published policies with files, read receipts. */
async function policies({ insert, id, tenantId, today, now, office, ownerId, spec, files, random }) {
  const categoryIds = {};
  await insert(
    "policycategories",
    DEFAULT_POLICY_CATEGORIES.map((c, i) => {
      const _id = id();
      categoryIds[c.name] = _id;
      return { _id, ...c, nameKey: policyNameKey(c.name), sortOrder: i, isDefault: true, isArchived: false, createdBy: ownerId };
    })
  );
  const list = [...POLICIES.common, ...(POLICIES[spec.key] || [])];
  const policyDocs = [];
  const versions = [];
  const receipts = [];
  for (const [i, [category, title, summary, lines]] of list.entries()) {
    const policyId = id();
    const versionId = id();
    const published = new Date(today.getTime() - (60 + i * 20) * DAY);
    const fileName = `${safe(title)}.pdf`;
    const file = await files.pdf(`tenants/${tenantId}/policies/${policyId}/${versionId}-${fileName}`, title, [summary, "", ...lines]);
    versions.push({
      _id: versionId,
      policyId,
      versionNumber: 1,
      status: "published",
      file: { key: file.key, fileName, fileType: file.fileType, fileSize: file.fileSize },
      changeNote: "First version",
      effectiveDate: published,
      uploadedBy: ownerId,
      uploadedByName: office[0].name,
      publishedAt: published,
      publishedBy: ownerId,
      publishedByName: office[0].name,
      isDeleted: false,
    });
    policyDocs.push({
      _id: policyId,
      categoryId: categoryIds[category] || categoryIds.HR,
      title,
      summary,
      ownerId,
      status: "active",
      currentVersionId: versionId,
      currentVersionNumber: 1,
      currentPublishedAt: published,
      visibleToEmployees: true,
      audience: { mode: "all", roles: [], departments: [], sites: [], people: [], includeField: false },
      requireAck: i < 3,
      reviewIntervalMonths: 12,
      // One due for review soon, so the dashboard card has something to say.
      nextReviewDate: new Date(today.getTime() + (i === 1 ? 12 : 200 + i * 30) * DAY),
      lastReviewedAt: published,
      lastReviewedByName: office[0].name,
      reviewRemindersSent: [],
      createdBy: ownerId,
      createdByName: office[0].name,
      isDeleted: false,
    });
    if (i < 3) {
      for (const p of office) {
        const r = random();
        if (r < 0.2) continue; // not opened yet
        const opened = new Date(published.getTime() + Math.round(r * 10) * DAY);
        receipts.push({
          policyId,
          versionId,
          versionNumber: 1,
          employeeId: p._id,
          employeeKind: "office",
          firstOpenedAt: opened,
          lastOpenedAt: opened,
          openCount: 1 + Math.round(r * 2),
          acknowledgedAt: r > 0.35 ? opened : null,
        });
      }
    }
  }
  await insert("policyversions", versions);
  await insert("policies", policyDocs);
  await insert("policyreceipts", receipts);
  return policyDocs.length;
}

/** Staff asking HR to change what only HR may change. */
async function changeRequests({ insert, office, ownerId, today, spec }) {
  const [, a, b, c, d] = office;
  const rows = [];
  if (a) rows.push({ employeeId: a._id, employeeName: a.name, field: "name", label: "Full name", oldValue: a.name, newValue: `${a.name.split(" ")[0]} ${a.name.split(" ").slice(-1)[0]}-Grant`, reason: "Got married last month", status: "pending" });
  if (b) rows.push({ employeeId: b._id, employeeName: b.name, field: "email", label: "Email", oldValue: b.email, newValue: b.email.replace("@", ".work@"), reason: "Old inbox is full", status: "pending" });
  if (c) rows.push({ employeeId: c._id, employeeName: c.name, field: "dateOfBirth", label: "Date of birth", oldValue: "1985-03-04", newValue: "1985-04-03", reason: "Day and month were swapped", status: "approved", decidedBy: { _id: ownerId, name: office[0].name }, decidedAt: new Date(today.getTime() - 5 * DAY), decisionNote: "Checked against passport" });
  if (d) rows.push({ employeeId: d._id, employeeName: d.name, field: "name", label: "Full name", oldValue: d.name, newValue: d.name.toUpperCase(), reason: "Prefer capitals", status: "rejected", decidedBy: { _id: ownerId, name: office[0].name }, decidedAt: new Date(today.getTime() - 9 * DAY), decisionNote: "Names are kept as on the right-to-work document" });
  await insert("profilechangerequests", rows.map((r, i) => ({ ...r, createdAt: new Date(today.getTime() - (i + 1) * 2 * DAY) })));
  return rows.length;
}

/** A reception desk login, locked to the front-desk PC. */
async function reception({ insert, officeLocation, spec, nobodyHash, now }) {
  await insert("officeusers", [
    {
      name: `${spec.name} Reception`,
      email: `reception@${spec.domain}`,
      password: nobodyHash,
      authorizedDevices: [
        { deviceId: `demo-${spec.key}-front-desk`, deviceName: "Front desk PC", addedAt: now, locationId: officeLocation },
      ],
      restrictedIPAddresses: [],
      enforceDeviceLock: true,
      isReception: true,
      clockLocationId: officeLocation,
      isActive: true,
      delete: false,
    },
  ]);
  return 1;
}

const VISITORS = [
  ["Mark Jenkins", "Jenkins Supplies Ltd", "supplier", "delivery"],
  ["Rachel Moore", "Moore Architects", "guest", "meeting"],
  ["Steve Patel", "SafeSite Inspections", "contractor", "businessVisit"],
  ["Claire Dunn", "", "guest", "walkIn"],
  ["Ben Ashworth", "City Council", "other", "businessVisit"],
  ["Laura Chen", "Chen & Co Accountants", "guest", "meeting"],
  ["Tony Russo", "Russo Electrical", "contractor", "quotationVisit"],
];

/** The visitor book: some in now, most been and gone. */
async function visitors({ insert, today, spec }) {
  const now = new Date();
  const rows = VISITORS.map(([name, company, type, purpose], i) => {
    const day = new Date(today.getTime() - (i < 2 ? 0 : i) * DAY);
    const inAt = new Date(day.getTime() + (9 + i) * 3600000);
    const stillHere = i < 2;
    return {
      visitorName: name,
      visitorEmail: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@visitor.example`,
      visitorPhone: `07700 900${String(800 + i).padStart(3, "0")}`,
      visitorCompany: company,
      visitorPurpose: [
        {
          visitorPurpose: purpose,
          visitorType: type,
          visitorStatus: stillHere ? "Checked In" : "checkedOut",
          visitorCheckInTime: stillHere && inAt > now ? new Date(now.getTime() - 40 * 60000) : inAt,
          ...(stillHere ? {} : { visitorCheckOutTime: new Date(inAt.getTime() + 75 * 60000) }),
          visitorNotes: i === 2 ? "Annual inspection" : "",
        },
      ],
      createdAt: inAt,
      updatedAt: inAt,
    };
  });
  await insert("visitors", rows);
  return rows.length;
}

const EXPENSE_CATEGORIES = {
  construction: [["Materials", 25000], ["Plant hire", 15000], ["Travel", 3000], ["Tools", 5000]],
  restaurant: [["Food stock", 20000], ["Cleaning supplies", 2000], ["Repairs", 4000]],
  "restaurant-mcr": [["Food stock", 12000], ["Repairs", 3000]],
  tuition: [["Books and materials", 3000], ["Printing", 1000], ["Travel", 800]],
};
const EXPENSE_ITEMS = {
  construction: ["Timber delivery", "Cement bags", "Mini digger hire", "Train to site meeting", "Replacement drill", "Scaffold fixings"],
  restaurant: ["Fresh produce", "Olive oil order", "Dishwasher repair", "Cleaning chemicals", "Bread supplier"],
  "restaurant-mcr": ["Fresh produce", "Glassware", "Fridge seal repair"],
  tuition: ["Exam past papers", "Whiteboard pens", "Printer toner", "Textbooks"],
};

/** Spending against each place, with receipts. */
async function expenses({ insert, id, tenantId, today, office, ownerId, places, spec, files, random }) {
  const cats = (EXPENSE_CATEGORIES[spec.key] || EXPENSE_CATEGORIES.construction).map(([name, budget]) => ({
    _id: id(),
    name,
    description: `${name} for every ${places.length > 1 ? "place" : "site"}`,
    budget,
    companyId: tenantId,
    projectIds: places.map((p) => p._id),
    createdBy: ownerId,
    updatedBy: ownerId,
    status: true,
    isActive: true,
    isDeleted: false,
  }));
  await insert("expensecategories", cats);
  const items = EXPENSE_ITEMS[spec.key] || EXPENSE_ITEMS.construction;
  const claimants = office.filter((p) => p.manages?.length).concat(office.slice(0, 2));
  const rows = [];
  for (let i = 0; i < items.length * 2; i++) {
    const _id = id();
    const place = places[i % places.length];
    const cat = cats[i % cats.length];
    const who = claimants[i % claimants.length];
    const amount = Math.round((20 + random() * 600) * 100) / 100;
    const date = new Date(today.getTime() - (2 + i * 3) * DAY);
    const title = items[i % items.length];
    const file = await files.pdf(
      `tenants/${tenantId}/expenses/receipts/${place._id}/receipt-${_id}.pdf`,
      `Receipt - ${title}`,
      [`Amount: GBP ${amount.toFixed(2)}`, `Date: ${iso(date)}`, `For: ${place.siteName}`, `Claimed by: ${who.name}`]
    );
    const status = i < 3 ? "pending" : i % 7 === 0 ? "rejected" : "approved";
    rows.push({
      _id,
      employeeId: who._id,
      updatedBy: status === "pending" ? who._id : ownerId,
      title,
      amount,
      description: `${title} for ${place.siteName}`,
      categoryId: cat._id,
      categoryLabel: cat.name,
      companyId: tenantId,
      projectId: place._id,
      date,
      receiptFiles: [
        { key: file.key, access: "private", fileSize: file.fileSize, fileType: file.fileType, isDeleted: false, isArchived: false, uploadedAt: date, uploadedBy: who._id },
      ],
      status,
      isDeleted: false,
      createdAt: date,
      updatedAt: date,
    });
  }
  await insert("expenses", rows);
  return rows.length;
}

const DOC_TYPES = [
  ["contract", "Employment contract", (p, c) => [`Between ${c} and ${p.name}`, `Role: ${p.roleType}`, "Hours: 40 a week", "Notice: one month"]],
  ["rightToWork", "Right to work check", (p) => [`Employee: ${p.name}`, "Document: UK passport", "Checked by HR"]],
  ["id", "Photo ID", (p) => [`Name: ${p.name}`, "Type: driving licence"]],
  ["certificate", "Training certificate", (p, c, spec) => [`Awarded to ${p.name}`, spec.key === "construction" ? "CSCS card - Gold" : spec.key === "tuition" ? "DBS enhanced check - clear" : "Level 2 Food Hygiene"]],
];

/** Each office employee's documents, and the company's media library. */
async function documents({ insert, id, tenantId, today, office, ownerId, spec, files }) {
  const docs = [];
  for (const [n, p] of office.entries()) {
    const picks = DOC_TYPES.slice(0, n === 0 ? 2 : 2 + (n % 3));
    const documentsFiles = [];
    for (const [docType, title, lines] of picks) {
      const fileName = `${safe(title)}-${safe(p.name)}.pdf`;
      const file = await files.pdf(
        `tenants/${tenantId}/documents/${p._id}/${fileName}`,
        `${title} - ${p.name}`,
        lines(p, spec.name, spec)
      );
      documentsFiles.push({
        _id: id(),
        title,
        fileName,
        key: file.key,
        docType,
        access: "private",
        fileSize: file.fileSize,
        fileType: file.fileType,
        companyId: tenantId,
        isDeleted: false,
        isArchived: false,
        uploadedAt: new Date(today.getTime() - (30 + n) * DAY),
        uploadedBy: ownerId,
      });
    }
    docs.push({ employeeId: p._id, docType: "employee", description: `${p.name}'s documents`, documentsFiles, isDeleted: false });
  }
  await insert("documents", docs);

  const library = [
    ["Company handbook 2026", "policy"],
    ["Organisation chart", "general"],
    [spec.key === "tuition" ? "Term dates" : spec.key.startsWith("restaurant") ? "Winter menu" : "Site safety plan", "general"],
  ];
  const media = [];
  for (const [title, category] of library) {
    const fileName = `${safe(title)}.pdf`;
    const file = await files.pdf(`tenants/${tenantId}/media/${fileName}`, title, [spec.name, "Shared with all staff"]);
    media.push({
      fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      url: `/api/asset/${file.key}`,
      key: file.key,
      access: "private",
      status: "uploaded",
      metadata: { uploadedBy: String(ownerId), demo: true },
      category,
      tags: ["demo"],
    });
  }
  await insert("media", media);
  return docs.reduce((n, d) => n + d.documentsFiles.length, 0) + media.length;
}
