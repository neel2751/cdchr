/**
 * Announcement attachment upload tests.
 *
 * Attachments go browser → storage on a signed PUT, because a server action
 * accepts at most 1 MB. These drive the real server actions through the whole
 * three steps — start, PUT, finish — against a stand-in for S3 served on a
 * local port, so nothing reaches a real bucket and the "it arrived" check
 * reads back what was actually sent.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   TENANT_ENFORCEMENT=enforce npm run announcements:attachments:test
 *
 * Needs the same local database and fixtures as scripts/test-announcements.mjs.
 */
import assert from "node:assert";
import http from "node:http";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

// The stand-in for S3: keeps whatever is PUT, answers HEAD from it, and
// accepts DELETE. Path-style, as the SDK uses for an IP address endpoint.
const objects = new Map();
const store = http.createServer((req, res) => {
  const key = decodeURIComponent(new URL(req.url, "http://x").pathname)
    .split("/")
    .slice(2)
    .join("/");
  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      objects.set(key, {
        body: Buffer.concat(chunks),
        type: req.headers["content-type"] || "application/octet-stream",
      });
      res.writeHead(200, { ETag: '"x"' }).end();
    });
    return;
  }
  const obj = objects.get(key);
  if (req.method === "HEAD") {
    if (!obj) return res.writeHead(404).end();
    return res
      .writeHead(200, { "Content-Length": obj.body.length, "Content-Type": obj.type })
      .end();
  }
  if (req.method === "DELETE") {
    objects.delete(key);
    return res.writeHead(204).end();
  }
  res.writeHead(405).end();
});
await new Promise((r) => store.listen(0, "127.0.0.1", r));

// Before any import that builds an S3 client.
process.env.AWS_ENDPOINT_URL_S3 = `http://127.0.0.1:${store.address().port}`;
process.env.AWS_ACCESS_ID = "test";
process.env.AWS_ACCESS_PORTAL_KEY = "test";
process.env.AWS_REGION = "eu-west-2";
process.env.AWS_BUCKET_NAME = "attachment-tests";

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";

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
const MB = 1024 * 1024;

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database seeded with fixtures.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const { runWithTenant, runReadOnly } = await import("@/lib/tenantContext");
  const { actAs } = await import("@/scripts/lib/session-stub");
  const Company = (await import("@/models/companyModel")).default;
  const attachments = await import("@/server/announcementServer/announcementAttachments");

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
  const acmeUser = session("user@acme.test", "user", A);
  const betaSuper = session("super@beta.test", "superAdmin", B);

  const as = (user, fn) =>
    runWithTenant(user.tenantId, async () => {
      actAs(user);
      try {
        return await fn();
      } finally {
        actAs(null);
      }
    });

  // The browser's part: PUT the bytes to the signed URL, as the form does.
  const put = (url, body, type) =>
    fetch(url, { method: "PUT", body, headers: { "Content-Type": type } });

  console.log(`TENANT_ENFORCEMENT=${MODE}\n`);

  await check("a file over 1 MB goes up, and comes back with its real size", async () => {
    const body = Buffer.alloc(3 * MB, 7);
    const started = await as(acmeSuper, () =>
      attachments.startAnnouncementAttachment({
        fileName: "rota.pdf",
        contentType: "application/pdf",
        fileSize: body.length,
      }),
    );
    assert.equal(started.success, true, started.message);
    const { url, key } = parse(started);
    assert(key.startsWith(`tenants/${A}/announcements/`), key);
    assert.match(key, /\/[0-9a-f-]{36}-rota\.pdf$/, "the key should carry a random part");

    const sent = await put(url, body, "application/pdf");
    assert.equal(sent.status, 200);

    const finished = await as(acmeSuper, () =>
      attachments.finishAnnouncementAttachment({ key, fileName: "rota.pdf" }),
    );
    assert.equal(finished.success, true, finished.message);
    assert.deepEqual(parse(finished), {
      key,
      fileName: "rota.pdf",
      fileType: "application/pdf",
      fileSize: 3 * MB,
    });
  });

  await check("the signed URL fixes the size, and carries no checksum of an empty body", async () => {
    const started = await as(acmeSuper, () =>
      attachments.startAnnouncementAttachment({
        fileName: "small.pdf",
        contentType: "application/pdf",
        fileSize: 1000,
      }),
    );
    const params = new URL(parse(started).url).searchParams;
    assert.match(params.get("X-Amz-SignedHeaders"), /content-length/, "size is not signed");
    // The SDK's default signs a CRC32 of the empty body it was given, which
    // real storage would hold the uploaded file to and refuse.
    assert.equal(params.get("x-amz-checksum-crc32"), null, "an empty-body checksum is signed");
  });

  await check("over 25 MB is refused before anything is signed", async () => {
    const res = await as(acmeSuper, () =>
      attachments.startAnnouncementAttachment({ fileName: "big.mp4", fileSize: 26 * MB }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /25 MB/);
  });

  await check("an empty file is refused", async () => {
    const res = await as(acmeSuper, () =>
      attachments.startAnnouncementAttachment({ fileName: "x.txt", fileSize: 0 }),
    );
    assert.equal(res.success, false);
  });

  await check("only an author can start or finish an upload", async () => {
    const start = await as(acmeUser, () =>
      attachments.startAnnouncementAttachment({ fileName: "x.pdf", fileSize: 10 }),
    );
    assert.equal(start.success, false);
    const finish = await as(acmeUser, () =>
      attachments.finishAnnouncementAttachment({ key: `tenants/${A}/announcements/x` }),
    );
    assert.equal(finish.success, false);
  });

  await check("a read-only support visit cannot start an upload", async () => {
    const res = await runWithTenant(A, () =>
      runReadOnly(async () => {
        actAs(acmeSuper);
        try {
          return await attachments.startAnnouncementAttachment({
            fileName: "x.pdf",
            fileSize: 10,
          });
        } finally {
          actAs(null);
        }
      }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /read-only/);
  });

  await check("another company's file cannot be claimed", async () => {
    const started = await as(betaSuper, () =>
      attachments.startAnnouncementAttachment({ fileName: "b.pdf", fileSize: 5 }),
    );
    const { url, key } = parse(started);
    await put(url, Buffer.from("hello"), "application/octet-stream");

    const res = await as(acmeSuper, () =>
      attachments.finishAnnouncementAttachment({ key, fileName: "b.pdf" }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /does not belong/);
  });

  await check("a key outside the announcements folder is refused", async () => {
    for (const key of [
      `tenants/${A}/documents/payroll.pdf`,
      `tenants/${A}/announcements/../documents/payroll.pdf`,
    ]) {
      const res = await as(acmeSuper, () =>
        attachments.finishAnnouncementAttachment({ key, fileName: "x" }),
      );
      assert.equal(res.success, false, key);
    }
  });

  await check("finishing a file that never arrived says so", async () => {
    const res = await as(acmeSuper, () =>
      attachments.finishAnnouncementAttachment({
        key: `tenants/${A}/announcements/never-sent.pdf`,
        fileName: "never-sent.pdf",
      }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /did not arrive/);
  });

  await check("a file bigger than the limit on arrival is refused and removed", async () => {
    // Written behind the signature's back, as if the size check were bypassed.
    const key = `tenants/${A}/announcements/oversize.bin`;
    objects.set(key, { body: Buffer.alloc(26 * MB), type: "application/octet-stream" });
    const res = await as(acmeSuper, () =>
      attachments.finishAnnouncementAttachment({ key, fileName: "oversize.bin" }),
    );
    assert.equal(res.success, false);
    assert(!objects.has(key), "the oversize object was left in storage");
  });

  await mongoose.disconnect();
  store.close();

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [status, name] of results) console.log(`${status === "pass" ? "ok  " : "FAIL"} ${name}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${MODE})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
