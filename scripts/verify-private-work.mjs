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
const db = {
  prepare(source) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      compile() {
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
