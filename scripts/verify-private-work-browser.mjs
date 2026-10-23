import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";
import { chromium, webkit } from "playwright";
const root = process.cwd(),
  scratch = await mkdtemp(join(tmpdir(), "cbh-private-ci-")),
  config = resolve(".tmp-private-work-test.jsonc"),
  wrangler = resolve("node_modules/.bin/wrangler"),
  base = "https://127.0.0.1:18874";
let worker;
const run = (cmd, args, extra = {}) =>
  new Promise((yes, no) => {
    const p = spawn(cmd, args, {
      cwd: root,
      env: {
        ...process.env,
        CI: "1",
        WRANGLER_SEND_METRICS: "false",
        ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    p.stdout.on("data", (d) => (output += d));
    p.stderr.on("data", (d) => (output += d));
    p.on("error", no);
    p.on("exit", (code) =>
      code === 0 ? yes(output) : no(Error(output.slice(-4000))),
    );
  });
const key = randomBytes(32),
  password = "Synthetic-CI-Only!Password-123",
  newPassword = "Synthetic-Changed!Password-456";
const seal = (value) => {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("cbh-private-drive/v1"));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return iv.toString("base64") + "." + encrypted.toString("base64");
};
try {
  await writeFile(
    config,
    JSON.stringify({
      name: "cbh-local-private-test-do-not-deploy",
      main: "worker/testing/private-work-local.ts",
      compatibility_date: "2026-10-06",
      compatibility_flags: ["nodejs_compat"],
      assets: {
        directory: "dist",
        binding: "ASSETS",
        run_worker_first: ["/api", "/api/*"],
        not_found_handling: "single-page-application",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "come-back-home-db",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "db/migrations",
        },
      ],
      vars: {
        PRIVATE_WORK_ENABLED: "1",
        MUTATIONS_ENABLED: "1",
        PUSH_DELIVERY_ENABLED: "0",
        PROVIDER_RUNTIME_ENABLED: "0",
        PRIVATE_DRIVE_CLIENT_ID: "synthetic",
        PRIVATE_DRIVE_CLIENT_SECRET: "synthetic",
        PRIVATE_DRIVE_TOKEN_KEY: key.toString("base64"),
        PRIVATE_DRIVE_PICKER_KEY: "synthetic",
        PRIVATE_DRIVE_APP_ID: "000000",
      },
    }),
  );
  await run(wrangler, [
    "d1",
    "migrations",
    "apply",
    "come-back-home-db",
    "--local",
    "--config",
    config,
    "--persist-to",
    scratch,
  ]);
  const sql = [];
  const stamp = new Date().toISOString();
  for (const [id, login, role] of [
    ["admin-fixture", "ydh1121", "admin"],
    ["member-fixture", "yvonne", "member"],
  ]) {
    const salt = randomBytes(16),
      hash = pbkdf2Sync(password, salt, 600000, 32, "sha256");
    sql.push(
      `INSERT INTO auth_users VALUES('${id}','${login}','${role}',0,1,0,'${stamp}');`,
      `INSERT INTO auth_credentials VALUES('${id}','pbkdf2-sha256',600000,'${salt.toString("base64")}','${hash.toString("base64")}','${stamp}');`,
      `INSERT INTO auth_workspace_grants VALUES('${id}','legacy','write','${stamp}');`,
    );
  }
  sql.push(
    `INSERT INTO case_profiles VALUES('case-fixture','member-fixture','${stamp}');`,
    `INSERT INTO case_consents VALUES('case-fixture',0,'','',1,'member-fixture','${stamp}');`,
    `INSERT INTO case_drive_connections VALUES('case-fixture','${seal("synthetic-refresh")}','synthetic-google-subject','synthetic-folder','["synthetic-owner"]','member-fixture','${stamp}');`,
  );
  const seed = join(scratch, "synthetic.sql");
  await writeFile(seed, sql.join("\n"));
  await run(wrangler, [
    "d1",
    "execute",
    "come-back-home-db",
    "--local",
    "--config",
    config,
    "--persist-to",
    scratch,
    "--file",
    seed,
  ]);
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(scratch, "key.pem"),
    "-out",
    join(scratch, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  worker = spawn(
    wrangler,
    [
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      scratch,
      "--ip",
      "127.0.0.1",
      "--port",
      "18874",
      "--local-protocol",
      "https",
      "--https-key-path",
      join(scratch, "key.pem"),
      "--https-cert-path",
      join(scratch, "cert.pem"),
      "--log-level",
      "error",
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let logs = "";
  worker.stdout.on("data", (d) => (logs = (logs + d).slice(-3000)));
  worker.stderr.on("data", (d) => (logs = (logs + d).slice(-3000)));
  for (const [engine, label] of [
    [chromium, "chromium"],
    [webkit, "webkit"],
  ]) {
    const browser = await engine.launch({ headless: true }),
      ctx = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
      });
    const page = await ctx.newPage();
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const response = await ctx.request.get(base + "/api/auth/session");
        if (response.ok()) {
          ready = true;
          break;
        }
      } catch {}
      if (worker.exitCode !== null)
        throw Error("Local runtime stopped: " + logs);
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(ready, "local D1 runtime ready");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let anonymousLegacyRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/people")) anonymousLegacyRequests++;
    });
    await page.goto(base + "/injury");
    await page.getByRole("button", { name: "로그인", exact: true }).waitFor();
    assert.equal(anonymousLegacyRequests, 0, "no legacy data before login");
    await page.getByLabel("아이디", { exact: true }).fill("yvonne");
    await page
      .getByLabel("비밀번호", { exact: true })
      .fill(label === "chromium" ? password : newPassword);
    await page.getByLabel("이 기기에서 로그인 유지").check();
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    if (label === "chromium") {
      await page.getByRole("heading", { name: "임시 비밀번호 변경" }).waitFor();
      await page.getByLabel("현재 비밀번호", { exact: true }).fill(password);
      await page.getByLabel("새 비밀번호", { exact: true }).fill(newPassword);
      await page.getByLabel("새 비밀번호 다시 입력").fill(newPassword);
      await page.getByRole("button", { name: "변경 후 다시 로그인" }).click();
      await page.getByLabel("아이디", { exact: true }).fill("yvonne");
      await page.getByLabel("비밀번호", { exact: true }).fill(newPassword);
      await page.getByLabel("이 기기에서 로그인 유지").check();
      await page.getByRole("button", { name: "로그인", exact: true }).click();
    }
    await page
      .getByRole("heading", { name: "산재·직장", exact: true })
      .waitFor();
    const cookies = await ctx.cookies();
    const session = cookies.find((c) => c.name === "__Host-cbh-session");
    assert.ok(
      session?.httpOnly && session?.secure && session?.sameSite === "Lax",
      "secure server cookie",
    );
    for (const width of [375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "no horizontal overflow " + width,
      );
      await page.screenshot({ path: join(scratch, `${label}-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "기록 추가", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("제목", { exact: true })
      .fill("합성 할 일 " + label);
    await dialog.getByLabel("본문·메모").fill("합성 비공개 본문\n".repeat(300));
    await dialog.getByLabel("기한", { exact: true }).fill("2026-12-31");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const card = page
      .locator(".record-card")
      .filter({
        has: page.getByRole("heading", { name: "합성 할 일 " + label }),
      });
    await card.waitFor();
    await card.locator(".content-scroll").evaluate((n) => (n.scrollTop = 2000));
    const copy = await card.locator(".copy-button").boundingBox(),
      scroll = await card.locator(".content-scroll").boundingBox();
    assert.ok(
      copy.y >= scroll.y - 2 &&
        copy.y + copy.height <= scroll.y + scroll.height + 2,
      "copy stays within scrolled content",
    );
    await card.getByRole("button", { name: "편집", exact: true }).click();
    await dialog
      .getByLabel("제목", { exact: true })
      .fill("내 충돌 초안 " + label);
    const snapshot = await (
        await ctx.request.get(base + "/api/private/case")
      ).json(),
      record = snapshot.records.find(
        (r) => r.payload.title === "합성 할 일 " + label,
      );
    const api = async (path, body, method = "POST") =>
      ctx.request.fetch(base + "/api/" + path, {
        method,
        headers: { Origin: base },
        data: body,
      });
    let response = await api(
      "private/case/records/" + record.id,
      {
        kind: record.kind,
        revision: record.revision,
        payload: { ...record.payload, title: "다른 기기의 수정 " + label },
      },
      "PUT",
    );
    assert.equal(response.status(), 200);
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog
      .getByRole("heading", { name: "다른 기기의 최신 저장본" })
      .waitFor();
    assert.equal(
      await dialog.getByLabel("제목", { exact: true }).inputValue(),
      "내 충돌 초안 " + label,
    );
    await dialog
      .getByRole("button", { name: "최신본 확인 · 내 입력 계속 편집" })
      .click();
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "문서·메모", exact: true }).click();
    const bytes = Buffer.from("%PDF-synthetic-original-" + label);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "synthetic-" + label + ".pdf",
        mimeType: "application/pdf",
        buffer: bytes,
      });
    await page.getByRole("button", { name: "원본 보관", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "원본 보관 확인 완료" })
      .waitFor();
    const docs = await (
      await ctx.request.get(base + "/api/private/case")
    ).json();
    assert.equal(
      docs.documents.find((d) => d.filename === "synthetic-" + label + ".pdf")
        .status,
      "ready",
      "real D1 metadata after verified fake provider",
    );
    await page.reload();
    await page
      .getByRole("heading", { name: "산재·직장", exact: true })
      .waitFor();
    assert.ok(
      await page
        .locator(".document-list")
        .getByRole("heading", { name: "synthetic-" + label + ".pdf" })
        .isVisible(),
      "remembered login + document persistence",
    );
    await page.getByRole("link", { name: "내 계정", exact: true }).click();
    await page
      .getByRole("button", { name: "현재 기기 로그아웃", exact: true })
      .click();
    await page.getByRole("button", { name: "로그인", exact: true }).waitFor();
    response = await ctx.request.get(base + "/api/private/case");
    assert.equal(response.status(), 401, "logout invalidates real D1 session");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("cbh:import-batches:v2")),
      null,
      "draft cache removed",
    );
    await page.goBack();
    await page.getByRole("button", { name: "로그인", exact: true }).waitFor();
    assert.equal(
      await page.locator(".record-card").count(),
      0,
      "back does not reveal private records",
    );
    assert.deepEqual(errors, [], "no browser errors");
    await ctx.close();
    await browser.close();
    console.log(
      "PRIVATE_BROWSER_D1_PASS " +
        label +
        " responsive_375_390_768_1024_1440 login_first_change_cookie_conflict_copy_drive_verify_logout_back",
    );
  }
} finally {
  if (worker) {
    try {
      process.kill(-worker.pid, "SIGTERM");
    } catch {}
  }
  await rm(config, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
