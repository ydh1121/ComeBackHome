import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "vite";
const vite = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});
const sql = new DatabaseSync(":memory:");
let beforeStatement = null;
const db = {
  prepare(source) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      compile() {
        if (beforeStatement) beforeStatement(source);
        const bound = [];
        const text = source.replace(/\?(\d+)/g, (_, n) => {
          bound.push(args[Number(n) - 1]);
          return "?";
        });
        return [sql.prepare(text), bound];
      },
      async all() {
        const [q, a] = this.compile();
        return { success: true, results: q.all(...a) };
      },
      async first() {
        return (await this.all()).results[0] ?? null;
      },
      async run() {
        const [q, a] = this.compile();
        return /RETURNING/i.test(source)
          ? { success: true, results: q.all(...a) }
          : { success: true, meta: q.run(...a) };
      },
    };
  },
  async batch(statements) {
    sql.exec("BEGIN");
    try {
      const result = [];
      for (const s of statements) result.push(await s.run());
      sql.exec("COMMIT");
      return result;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  },
};
const load = (p) => vite.ssrLoadModule("/" + p),
  origin = "https://local.invalid";
let checks = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
try {
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sql.exec(await readFile("db/migrations/" + name, "utf8"));
  const cryptoModule = await load("worker/modules/auth/crypto.ts");
  const password = "synthetic-fixture-only!123",
    hash = await cryptoModule.hashPassword(password);
  check(
    await cryptoModule.verifyPassword(password, hash),
    true,
    "600k credential verifies",
  );
  check(
    await cryptoModule.verifyPassword(password + "x", hash),
    false,
    "wrong password rejected",
  );
  const now = new Date().toISOString();
  for (const [id, name, role] of [
    ["admin-fixture", "ydh1121", "admin"],
    ["member-fixture", "yvonne", "member"],
  ]) {
    sql
      .prepare("INSERT INTO auth_users VALUES(?,?,?,0,1,0,?)")
      .run(id, name, role, now);
    sql
      .prepare("INSERT INTO auth_credentials VALUES(?,?,?,?,?,?)")
      .run(
        id,
        hash.algorithm,
        hash.iterations,
        hash.salt_b64,
        hash.hash_b64,
        now,
      );
  }
  sql
    .prepare("INSERT INTO case_profiles VALUES(?,?,?)")
    .run("case-fixture", "member-fixture", now);
  sql
    .prepare("INSERT INTO case_consents VALUES(?,0,?,?,1,?,?)")
    .run("case-fixture", "", "", "member-fixture", now);
  const { handleProductRequest } = await load("worker/modules/gateway.ts");
  const env = { DB: db, PRIVATE_WORK_ENABLED: "1", MUTATIONS_ENABLED: "1" };
  let driveFetcher = fetch;
  const call = (path, method = "GET", body, cookie, originHeader = origin) =>
    handleProductRequest(
      new Request(origin + "/api/" + path, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          Origin: originHeader,
          "CF-Connecting-IP": "synthetic-" + path.split("/").at(-1),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      null,
      driveFetcher,
    );
  check(
    (await call("private/case")).status,
    401,
    "anonymous private API blocked",
  );
  check((await call("people")).status, 401, "anonymous old API blocked");
  check(
    (
      await call(
        "auth/login",
        "POST",
        { loginId: "yvonne", password },
        null,
        "https://attacker.invalid",
      )
    ).status,
    403,
    "cross-site login blocked",
  );
  let login = await call("auth/login", "POST", {
    loginId: "yvonne",
    password,
    remember: true,
  });
  check(login.status, 200, "login succeeds");
  let member = login.headers.get("Set-Cookie").split(";")[0];
  assert.match(
    login.headers.get("Set-Cookie"),
    /Secure; SameSite=Lax; Max-Age=/,
  );
  assert.match(login.headers.get("Set-Cookie"), /HttpOnly/);
  check(
    (await call("private/case", "GET", undefined, member)).status,
    403,
    "first change required",
  );
  check(
    (
      await call(
        "auth/password",
        "POST",
        { currentPassword: password, newPassword: "synthetic-new-secret!456" },
        member,
      )
    ).status,
    200,
    "force password change",
  );
  check(
    (await call("private/case", "GET", undefined, member)).status,
    401,
    "old cookie invalidated",
  );
  login = await call("auth/login", "POST", {
    loginId: "yvonne",
    password: "synthetic-new-secret!456",
  });
  member = login.headers.get("Set-Cookie").split(";")[0];
  check(
    (await call("private/case", "GET", undefined, member)).status,
    200,
    "owner case access",
  );
  check(
    (await call("people", "GET", undefined, member)).status,
    403,
    "legacy workspace not implicitly granted",
  );
  sql
    .prepare(
      "UPDATE auth_users SET must_change_password=0 WHERE id='admin-fixture'",
    )
    .run();
  login = await call("auth/login", "POST", { loginId: "ydh1121", password });
  const admin = login.headers.get("Set-Cookie").split(";")[0];
  check(
    (await call("private/case", "GET", undefined, admin)).status,
    403,
    "admin requires owner consent",
  );
  check(
    (
      await call(
        "private/case/consent",
        "PUT",
        {
          adminAccess: true,
          purpose: "Synthetic joint management",
          retention: "Synthetic test only",
          revision: 1,
        },
        member,
      )
    ).status,
    200,
    "owner consent",
  );
  check(
    (await call("private/case", "GET", undefined, admin)).status,
    200,
    "consented admin",
  );
  const payload = {
    title: "Synthetic task",
    body: "Long editable body\n".repeat(1000),
    certainty: "reported",
    sourceIds: [],
    data: {
      status: "todo",
      deadlineKind: "recommended",
      dueDate: "2026-12-31",
    },
  };
  let saved = await call(
    "private/case/records/record-fixture",
    "PUT",
    { kind: "task", revision: 0, payload },
    member,
  );
  check(saved.status, 200, "create record");
  check(
    (
      await call(
        "private/case/records/record-fixture",
        "PUT",
        {
          kind: "task",
          revision: 1,
          payload: { ...payload, title: "First editor" },
        },
        admin,
      )
    ).status,
    200,
    "admin edit",
  );
  check(
    (
      await call(
        "private/case/records/record-fixture",
        "PUT",
        {
          kind: "task",
          revision: 1,
          payload: { ...payload, title: "Stale editor" },
        },
        member,
      )
    ).status,
    409,
    "stale write rejected",
  );
  let read = await (
    await call(
      "private/case/records/record-fixture/history",
      "GET",
      undefined,
      member,
    )
  ).json();
  check(read.history.length, 2, "immutable history only saved versions");
  assert.throws(
    () => sql.prepare("UPDATE case_revisions SET revision=88").run(),
    /IMMUTABLE/,
  );
  check(
    (
      await call(
        "private/case/consent",
        "PUT",
        { adminAccess: false, purpose: "", retention: "", revision: 2 },
        member,
      )
    ).status,
    200,
    "withdrawal",
  );
  check(
    (await call("private/case/records/record-fixture", "GET", undefined, admin))
      .status,
    403,
    "withdrawal immediately blocks",
  );
  check(
    (await call("private/case/documents/status", "GET", undefined, admin))
      .status,
    403,
    "documents same ACL",
  );
  check(
    (
      await call(
        "private/case/records/official-fixture",
        "PUT",
        {
          kind: "intake",
          revision: 0,
          payload: {
            title: "Official without evidence",
            body: "",
            certainty: "official",
            sourceIds: [],
            data: { status: "approved", caseType: "disease" },
          },
        },
        member,
      )
    ).status,
    400,
    "unproven official state rejected",
  );
  // Interleave a revocation at the actual SQL mutation boundary.
  await call(
    "private/case/consent",
    "PUT",
    {
      adminAccess: true,
      purpose: "Synthetic",
      retention: "Only test",
      revision: 3,
    },
    member,
  );
  beforeStatement = (source) => {
    if (!source.startsWith("INSERT INTO case_records")) return;
    beforeStatement = null;
    sql.exec("UPDATE case_consents SET admin_access=0,revision=revision+1");
  };
  check(
    (
      await call(
        "private/case/records/race-record",
        "PUT",
        { kind: "task", revision: 0, payload },
        admin,
      )
    ).status,
    403,
    "consent revoked after authentication blocks the SQL write",
  );
  check(
    sql
      .prepare("SELECT count(*) n FROM case_records WHERE id='race-record'")
      .get().n,
    0,
    "revoked write creates no record",
  );
  const secondLogin = await call("auth/login", "POST", {
    loginId: "yvonne",
    password: "synthetic-new-secret!456",
  });
  const secondCookie = secondLogin.headers.get("Set-Cookie").split(";")[0];
  const secondHash = await cryptoModule.digest(secondCookie.split("=")[1]);
  beforeStatement = (source) => {
    if (!source.startsWith("UPDATE case_consents")) return;
    beforeStatement = null;
    sql
      .prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?")
      .run(now, secondHash);
  };
  check(
    (
      await call(
        "private/case/consent",
        "PUT",
        {
          adminAccess: true,
          purpose: "Synthetic",
          retention: "Only test",
          revision: 5,
        },
        secondCookie,
      )
    ).status,
    403,
    "logout racing with consent prevents write",
  );
  check(
    sql.prepare("SELECT admin_access FROM case_consents").get().admin_access,
    0,
    "revoked session cannot grant consent",
  );
  let inserts = 0;
  const beforeCount = sql
    .prepare("SELECT count(*) n FROM case_records")
    .get().n;
  const beforeAudit = sql
    .prepare("SELECT count(*) n FROM case_audit WHERE action='record-create'")
    .get().n;
  beforeStatement = (source) => {
    if (!source.startsWith("INSERT INTO case_records")) return;
    if (++inserts === 2) {
      beforeStatement = null;
      throw Error("synthetic D1 transaction failure");
    }
  };
  check(
    (
      await call(
        "private/case/import",
        "POST",
        {
          version: "cbh-case-seed/v1",
          approved: true,
          records: [
            { kind: "task", payload: { ...payload, title: "Atomic A" } },
            { kind: "task", payload: { ...payload, title: "Atomic B" } },
          ],
        },
        member,
      )
    ).status,
    503,
    "import transaction fails safely",
  );
  check(
    sql.prepare("SELECT count(*) n FROM case_records").get().n,
    beforeCount,
    "batch rollback retains old records",
  );
  check(
    sql
      .prepare("SELECT count(*) n FROM case_audit WHERE action='record-create'")
      .get().n,
    beforeAudit,
    "batch rollback also rolls back audit and history",
  );

  const { createDriveFixture } = await load(
    "worker/testing/private-work-local.ts",
  );
  const fixtureDrive = createDriveFixture();
  driveFetcher = fixtureDrive.fetcher;
  const { seal: sealToken } = await load("worker/modules/documents/drive.ts");
  env.PRIVATE_DRIVE_CLIENT_ID = "synthetic";
  env.PRIVATE_DRIVE_CLIENT_SECRET = "synthetic";
  env.PRIVATE_DRIVE_TOKEN_KEY = cryptoModule.encode64(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  sql
    .prepare("INSERT INTO case_drive_connections VALUES(?,?,?,?,?,?,?)")
    .run(
      "case-fixture",
      await sealToken("synthetic", env),
      "synthetic-subject",
      "synthetic-folder",
      JSON.stringify(["synthetic-owner"]),
      "member-fixture",
      now,
    );
  const pdf = new TextEncoder().encode("%PDF-synthetic-private-upload");
  const descriptor = {
    filename: "synthetic.pdf",
    mime: "application/pdf",
    bytes: pdf.length,
    sha256: await cryptoModule.digest(pdf.buffer),
  };
  let reserve = await call(
    "private/case/documents",
    "POST",
    descriptor,
    member,
  );
  check(reserve.status, 201, "reserve private original");
  const doc = (await reserve.json()).id,
    docPath = "private/case/documents/" + doc;
  check(
    (await call(docPath + "/download", "GET", undefined, member)).status,
    409,
    "unverified original cannot download",
  );
  check(
    (await call(docPath + "/upload", "POST", {}, member)).status,
    200,
    "start resumable original",
  );
  fixtureDrive.expire(fixtureDrive.ids()[0]);
  check(
    (await (await call(docPath + "/upload", "POST", {}, member)).json()).offset,
    0,
    "expired incomplete session restarts without deleting original",
  );
  const upload = await handleProductRequest(
    new Request(origin + "/api/" + docPath + "/upload?offset=0", {
      method: "PUT",
      headers: { Origin: origin, Cookie: member },
      body: pdf,
    }),
    env,
    null,
    driveFetcher,
  );
  check(upload.status, 200, "stream original chunk through actual handler");
  fixtureDrive.expire(fixtureDrive.ids()[0]);
  check(
    (await (await call(docPath + "/upload", "POST", {}, member)).json())
      .complete,
    true,
    "lost completion response recovers verified original",
  );
  check(
    sql.prepare("SELECT status FROM case_documents WHERE id=?").get(doc).status,
    "ready",
    "recovery confirms hash size and permission before ready",
  );
  check(
    (
      await (
        await call("private/case/documents", "POST", descriptor, member)
      ).json()
    ).id,
    doc,
    "duplicate upload reuses same original",
  );
  const original = await call(docPath + "/download", "GET", undefined, member);
  check(
    await original.text(),
    new TextDecoder().decode(pdf),
    "download bytes match original",
  );
  fixtureDrive.corruptDownload(true);
  check(
    (await call(docPath + "/download", "GET", undefined, member)).status,
    409,
    "download race cannot substitute changed bytes",
  );
  fixtureDrive.corruptDownload(false);
  fixtureDrive.share(true);
  check(
    (await call(docPath + "/handoff", "GET", undefined, member)).status,
    403,
    "changed sharing blocks handoff",
  );
  fixtureDrive.share(false);
  fixtureDrive.changeRevision("replaced");
  check(
    (await call(docPath + "/handoff", "GET", undefined, member)).status,
    409,
    "changed original revision blocked even with same hash",
  );
  fixtureDrive.changeRevision("synthetic-revision");
  check(
    (await call(docPath + "/archive", "POST", {}, member)).status,
    200,
    "hide original metadata",
  );
  check(fixtureDrive.ids().length, 1, "hide never deletes Drive original");
  check(
    (await call(docPath + "/restore", "POST", {}, member)).status,
    200,
    "restore rechecks original integrity",
  );

  const claimPayload = {
    title: "Synthetic claim",
    body: "",
    certainty: "reported",
    sourceIds: [],
    data: {
      benefitType: "unemployment",
      status: "estimate",
      dailyRate: 60000,
      allocatedDays: 150,
    },
  };
  check(
    (
      await call(
        "private/case/records/claim-test",
        "PUT",
        { kind: "benefit_claim", revision: 0, payload: claimPayload },
        member,
      )
    ).status,
    200,
    "create benefit claim",
  );
  check(
    (
      await call(
        "private/case/records/payment-proof",
        "PUT",
        {
          kind: "content",
          revision: 0,
          payload: {
            title: "Synthetic official decision",
            body: "",
            certainty: "official",
            sourceIds: [doc],
            data: { category: "reference", medium: "none" },
          },
        },
        member,
      )
    ).status,
    200,
    "source-backed payment proof",
  );
  const event = {
    claimId: "claim-test",
    eventType: "decision",
    amount: 120000,
    recognizedDays: 2,
    eventDate: "2026-10-23",
    sourceRecordId: "payment-proof",
    reference: "decision-synthetic",
  };
  const decision = await call("private/case/payments", "POST", event, member);
  check(decision.status, 201, "append official decision");
  const decisionId = (await decision.json()).id;
  check(
    (await (await call("private/case/payments", "POST", event, member)).json())
      .duplicate,
    true,
    "payment replay idempotent",
  );
  check(
    (
      await call(
        "private/case/payments",
        "POST",
        { ...event, amount: 1 },
        member,
      )
    ).status,
    409,
    "same reference with different content rejected",
  );
  check(
    (
      await call(
        "private/case/payments",
        "POST",
        {
          ...event,
          eventType: "decision_adjustment",
          correctsId: decisionId,
          amount: -120001,
          recognizedDays: 0,
          reference: "adjust-negative",
        },
        member,
      )
    ).status,
    409,
    "negative decision aggregate rejected atomically",
  );
  const deposit = await call(
    "private/case/payments",
    "POST",
    {
      ...event,
      eventType: "deposit",
      amount: 100000,
      recognizedDays: 0,
      reference: "deposit-synthetic",
    },
    member,
  );
  const depositId = (await deposit.json()).id;
  check(deposit.status, 201, "actual deposit independent from decision");
  const refund = {
    ...event,
    eventType: "refund",
    correctsId: depositId,
    amount: 60000,
    recognizedDays: 0,
    reference: "refund-one",
  };
  check(
    (await call("private/case/payments", "POST", refund, member)).status,
    201,
    "partial refund",
  );
  check(
    (
      await call(
        "private/case/payments",
        "POST",
        { ...refund, reference: "refund-two" },
        member,
      )
    ).status,
    409,
    "cumulative refunds cannot exceed original deposit",
  );
  env.MUTATIONS_ENABLED = "0";
  check(
    (await call("auth/logout", "POST", {}, admin)).status,
    200,
    "security logout works during business write hold",
  );
  env.MUTATIONS_ENABLED = "1";
  check(
    (await call("auth/logout-all", "POST", {}, member)).status,
    200,
    "logout all",
  );
  check(
    (await call("private/case", "GET", undefined, member)).status,
    401,
    "revoked session denied",
  );
  const {
    estimateWorkInjury,
    estimateUnemployment,
    insuredDays,
    summarizeLedger,
    simulateEmployment,
  } = await load("src/modules/injury/domain/calculations.ts");
  const policy = {
    id: "synthetic-policy",
    key: "work_injury",
    version: "synthetic",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    status: "effective",
    sourceUrl: "https://law.go.kr/synthetic",
    checkedAt: "2026-10-23",
    values: {
      baseRate: 0.7,
      lowRate: 0.9,
      minimumCompensationDaily: 100000,
      lowThresholdRate: 0.8,
      minimumWageDaily: 80000,
      excludedShortDays: 3,
      maximumCompensationDaily: 300000,
    },
  };
  check(
    estimateWorkInjury(
      {
        date: "2026-10-23",
        averageDailyWage: 200000,
        incapacityDays: 3,
        partialWork: false,
        specialCase: false,
      },
      policy,
    ).amount,
    0,
    "<=3 excluded",
  );
  check(
    estimateWorkInjury(
      {
        date: "2026-10-23",
        averageDailyWage: 200000,
        incapacityDays: 4,
        partialWork: false,
        specialCase: false,
      },
      policy,
    ).amount,
    560000,
    "4 days does not subtract first three",
  );
  check(
    estimateWorkInjury(
      {
        date: "2026-10-23",
        averageDailyWage: 200000,
        incapacityDays: 4,
        partialWork: true,
        specialCase: false,
      },
      policy,
    ).amount,
    null,
    "partial work requires review",
  );
  assert.throws(
    () =>
      estimateWorkInjury(
        {
          date: "2027-01-01",
          averageDailyWage: 1,
          incapacityDays: 10,
          partialWork: false,
          specialCase: false,
        },
        policy,
      ),
    /VERIFIED_POLICY/,
  );
  const paid = [
    {
      date: "2026-10-01",
      employmentId: "one",
      type: "paid_work",
      verification: "documented",
      sourceId: "d",
    },
    {
      date: "2026-10-01",
      employmentId: "one",
      type: "paid_holiday",
      verification: "agency",
      sourceId: "d",
    },
    {
      date: "2026-10-02",
      employmentId: "one",
      type: "paid_work",
      verification: "estimated",
    },
    {
      date: "2026-10-03",
      employmentId: "one",
      type: "paid_work",
      verification: "documented",
      sourceId: "d",
    },
    {
      date: "2026-10-03",
      employmentId: "two",
      type: "paid_work",
      verification: "documented",
      sourceId: "d",
    },
  ];
  const window = { months: 18, requiredDays: 180 };
  const total = insuredDays(paid, "2026-10-23", window);
  check(
    [total.documentedDays, total.estimatedDays, total.ambiguousDates.length],
    [1, 1, 1],
    "dedupe vs ambiguous vs estimated",
  );
  const ledger = summarizeLedger(
    {
      benefitType: "unemployment",
      dailyRate: 60000,
      allocatedDays: 150,
      expectedAmount: null,
    },
    [{ id: "a", eventType: "decision", amount: 1680000, recognizedDays: 28 }],
  );
  check(
    [ledger.remainingDays, ledger.actualPaid, ledger.approvedOutstanding],
    [122, 0, 1680000],
    "recognized does not imply deposit",
  );
  check(
    summarizeLedger(
      {
        benefitType: "workers_comp_leave",
        dailyRate: 70000,
        allocatedDays: 60,
        expectedAmount: null,
      },
      [{ id: "b", eventType: "decision", amount: 1400000, recognizedDays: 20 }],
    ).remainingDays,
    null,
    "treatment days never become fixed leave benefit remaining",
  );
  const simulation = simulateEmployment(
    {
      previous: [],
      hireDate: "2026-10-01",
      leaveDate: "2026-10-10",
      paidWeekdays: [1, 2, 3, 4, 5],
      unpaidDates: ["2026-10-02"],
      extraPaidDates: [],
      weeklyHolidayVerified: false,
    },
    window,
  );
  check(
    simulation.firstExpectedDate,
    null,
    "unverified weekly holiday no automatic threshold",
  );
  const { caseDeadlines } = await load(
    "src/modules/injury/domain/deadlines.ts",
  );
  const { validPolicy } = await load("src/modules/injury/domain/policies.ts");
  const policies = JSON.parse(
    await readFile("docs/private-work/policies/2026-confirmed.json", "utf8"),
  ).policies;
  check(
    policies.every(validPolicy),
    true,
    "prepared official policy file validates without activating data",
  );
  check(
    validPolicy({ ...policies[0], sourceUrl: "https://lawXgoYkr/forged" }),
    false,
    "lookalike official domain rejected",
  );
  check(
    validPolicy({ ...policies[0], key: "__proto__" }),
    false,
    "unknown policy key rejected safely",
  );
  const unemploymentPolicy = policies.find((p) => p.key === "unemployment");
  const unemploymentInput = {
    date: "2026-10-24",
    averageDailyWage: 100000,
    ordinaryDailyWage: 120000,
    dailyWorker: false,
    specialBasis: false,
    scheduledDailyHours: 8,
    allocatedDays: 150,
  };
  check(
    estimateUnemployment(unemploymentInput, unemploymentPolicy).dailyRate,
    68100,
    "ordinary wage higher than average uses statutory cap",
  );
  check(
    estimateUnemployment(
      { ...unemploymentInput, dailyWorker: true },
      unemploymentPolicy,
    ).dailyRate,
    66048,
    "daily worker uses average wage and eight-hour floor",
  );
  check(
    estimateUnemployment(
      { ...unemploymentInput, scheduledDailyHours: 4 },
      unemploymentPolicy,
    ).amount,
    null,
    "unverified short-hour formula not extrapolated",
  );
  check(
    estimateUnemployment(
      { ...unemploymentInput, specialBasis: true },
      unemploymentPolicy,
    ).amount,
    null,
    "special basis needs agency calculation",
  );
  const deadlinePolicy = policies.find((p) => p.key === "deadlines");
  const treatment = {
    id: "treatment-test",
    caseId: "case-fixture",
    kind: "treatment",
    payload: {
      title: "Synthetic",
      body: "",
      certainty: "official",
      sourceIds: ["synthetic-proof"],
      data: {
        status: "approved",
        to: "2026-11-10",
        requestedTo: "2026-12-10",
        extensionConsidered: true,
      },
    },
    revision: 1,
    updatedBy: "member-fixture",
    updatedAt: now,
    archivedAt: null,
  };
  const deadlines = caseDeadlines([treatment], "2026-10-23", [deadlinePolicy]);
  check(
    deadlines.map((d) => d.date),
    ["2026-10-27", "2026-10-31", "2026-11-03"],
    "T14 T10 T7 use approved end, never requested extension",
  );
  check(
    caseDeadlines(
      [
        {
          ...treatment,
          payload: { ...treatment.payload, certainty: "reported" },
        },
      ],
      "2026-10-23",
      [deadlinePolicy],
    ).length,
    0,
    "unconfirmed treatment has no automatic legal deadline",
  );
  check(
    caseDeadlines([treatment], "2026-10-23", []).length,
    0,
    "unregistered policy never invents legal deadlines",
  );
  check(
    caseDeadlines([{ ...treatment, archivedAt: now }], "2026-10-23", [
      deadlinePolicy,
    ]).length,
    0,
    "archiving cancels derived reminders",
  );
  const updated = {
    ...treatment,
    revision: 2,
    payload: {
      ...treatment.payload,
      data: { ...treatment.payload.data, to: "2026-11-20" },
    },
  };
  check(
    caseDeadlines([updated], "2026-10-23", [deadlinePolicy]).some((d) =>
      deadlines.some((old) => old.id === d.id),
    ),
    false,
    "revised approved end replaces old reminder identities",
  );
  const opinion = {
    ...treatment,
    id: "opinion-test",
    kind: "employer_opinion",
    payload: {
      ...treatment.payload,
      data: {
        status: "no_response",
        notifiedAt: "2026-10-10",
        extensionConfirmed: false,
      },
    },
  };
  check(
    caseDeadlines([opinion], "2026-10-23", [deadlinePolicy])[0].date,
    "2026-10-20",
    "business reply not employee obligation",
  );
  check(
    caseDeadlines(
      [
        {
          ...opinion,
          payload: {
            ...opinion.payload,
            data: { ...opinion.payload.data, extensionConfirmed: true },
          },
        },
      ],
      "2026-10-23",
      [deadlinePolicy],
    )[0].date,
    "2026-10-27",
    "extension only after explicitly confirmed",
  );
  const futurePolicy = {
    ...deadlinePolicy,
    effectiveFrom: "2026-11-27",
    effectiveTo: "2027-01-01",
    status: "enacted",
  };
  check(
    caseDeadlines([opinion], "2026-10-23", [futurePolicy]).length,
    0,
    "future enacted policy not active",
  );
  check(
    insuredDays(paid, "2026-10-23", {
      ...window,
      priorBenefitLostDate: "2026-10-02",
    }).documentedDays,
    0,
    "previous benefit periods excluded from paid-day count",
  );
  assert.throws(
    () => insuredDays([], "2026-10-23", { ...window, extensionDays: 30 }),
    /EXCEPTION_EVIDENCE/,
  );
  check(
    insuredDays([], "2026-10-23", {
      ...window,
      extensionDays: 5000,
      exceptionEvidence: "proof",
      exceptionKind: "illness_unpaid",
      maxMonths: 36,
    }).start,
    "2023-10-24",
    "extension never exceeds three year limit",
  );
  check(
    insuredDays([], "2026-10-23", {
      months: 24,
      requiredDays: 180,
      exceptionEvidence: "proof",
      exceptionKind: "short_hours",
    }).start,
    "2024-10-24",
    "documented short-hours window",
  );
  const { aggregateInsuredPeriods } = await load(
    "src/modules/injury/domain/calculations.ts",
  );
  check(
    aggregateInsuredPeriods(
      [{ from: "2024-02-28", lost: "2024-03-02", previousBenefitsUsed: false }],
      "2024-03-01",
    ).insuredCalendarDays,
    3,
    "insured calendar days include leap day, distinct from paid days",
  );
  check(
    aggregateInsuredPeriods(
      [
        { from: "2020-01-01", lost: "2020-02-01", previousBenefitsUsed: false },
        { from: "2024-01-01", lost: "2024-02-01", previousBenefitsUsed: false },
      ],
      "2024-02-01",
    ).insuredCalendarDays,
    31,
    "long insurance gap prevents prior period aggregation",
  );
  // Policies are editable records, imported atomically and replay-safe.
  login = await call("auth/login", "POST", {
    loginId: "yvonne",
    password: "synthetic-new-secret!456",
  });
  member = login.headers.get("Set-Cookie").split(";")[0];
  const currentConsent = (
    await (await call("private/case/consent", "GET", undefined, member)).json()
  ).consent;
  await call(
    "private/case/consent",
    "PUT",
    {
      adminAccess: true,
      purpose: "Synthetic policy review",
      retention: "Test only",
      revision: currentConsent.revision,
    },
    member,
  );
  const adminLogin = await call("auth/login", "POST", {
    loginId: "ydh1121",
    password,
  });
  const adminPolicy = adminLogin.headers.get("Set-Cookie").split(";")[0];
  const policyRequest = { version: "cbh-policy/v1", policies, approved: true };
  check(
    (await call("private/case/policies/import", "POST", policyRequest, member))
      .status,
    403,
    "only administrator publishes legal policies",
  );
  check(
    (
      await (
        await call(
          "private/case/policies/import",
          "POST",
          policyRequest,
          adminPolicy,
        )
      ).json()
    ).inserted,
    5,
    "atomic policy import",
  );
  check(
    (
      await (
        await call(
          "private/case/policies/import",
          "POST",
          policyRequest,
          adminPolicy,
        )
      ).json()
    ).inserted,
    0,
    "same policy replay adds no duplicate",
  );
  check(
    (
      await call(
        "private/case/policies",
        "POST",
        {
          policy: {
            ...policies[0],
            values: { ...policies[0].values, baseRate: 0.8 },
          },
        },
        adminPolicy,
      )
    ).status,
    409,
    "same policy version cannot silently change rates",
  );
  check(
    (
      await call(
        "private/case/records/record-fixture",
        "DELETE",
        { revision: 2 },
        member,
      )
    ).status,
    200,
    "archive keeps prior history",
  );
  check(
    (
      await call(
        "private/case/records/record-fixture/restore",
        "POST",
        { revision: 3 },
        member,
      )
    ).status,
    200,
    "restore uses revision and owner ACL",
  );
  check(
    (
      await (
        await call(
          "private/case/records/record-fixture/history",
          "GET",
          undefined,
          member,
        )
      ).json()
    ).history.length,
    4,
    "archive and restore are immutable revisions",
  );
  const { DriveArchive, seal, unseal, validFilePrefix } = await load(
    "worker/modules/documents/drive.ts",
  );
  const keyEnv = {
    DB: db,
    PRIVATE_DRIVE_TOKEN_KEY: cryptoModule.encode64(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
  };
  const encrypted = await seal("synthetic-token", keyEnv);
  check(
    await unseal(encrypted, keyEnv),
    "synthetic-token",
    "AEAD encrypted credentials",
  );
  await assert.rejects(() => unseal(encrypted + "X", keyEnv));
  const file = new TextEncoder().encode("%PDF-synthetic"),
    sha = await cryptoModule.digest(file.buffer);
  const fixture = async (url) => {
    if (url.includes("/permissions"))
      return Response.json({
        permissions: [{ id: "owner", type: "user", role: "owner" }],
      });
    return Response.json({
      id: "file-fixture",
      mimeType: "application/pdf",
      size: String(file.length),
      sha256Checksum: sha,
      parents: ["folder-fixture"],
      trashed: false,
    });
  };
  const drive = new DriveArchive("synthetic", fixture);
  check(
    (
      await drive.verify({
        id: "file-fixture",
        bytes: file.length,
        sha256: sha,
        mime: "application/pdf",
        folder: "folder-fixture",
        allowedPermissionIds: ["owner"],
      })
    ).id,
    "file-fixture",
    "verify original hash size ACL",
  );
  await assert.rejects(
    () =>
      drive.verify({
        id: "file-fixture",
        bytes: 1,
        sha256: sha,
        mime: "application/pdf",
        folder: "folder-fixture",
        allowedPermissionIds: ["owner"],
      }),
    /INTEGRITY/,
  );
  const publicDrive = new DriveArchive("synthetic", async (url) =>
    url.includes("/permissions")
      ? Response.json({
          permissions: [{ id: "public", type: "anyone", role: "reader" }],
        })
      : fixture(url),
  );
  await assert.rejects(
    () =>
      publicDrive.verify({
        id: "file-fixture",
        bytes: file.length,
        sha256: sha,
        mime: "application/pdf",
        folder: "folder-fixture",
        allowedPermissionIds: ["owner"],
      }),
    /NOT_PRIVATE/,
  );
  check(validFilePrefix(file.buffer, "application/pdf"), true, "PDF magic");
  check(validFilePrefix(file.buffer, "image/png"), false, "mismatched MIME");
  console.log(
    "PRIVATE_WORK_CONTRACT_PASS checks=" +
      checks +
      " auth_csrf_force_change_revocation_consent_races_history_ledger_rolling_days_drive_integrity",
  );
} finally {
  sql.close();
  await vite.close();
}
