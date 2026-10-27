import assert from "node:assert/strict";
import { verifyPublicAuthUi } from "./private-work/verify-public-auth-ui.mjs";
import { verifyAdvisorR1 } from "./private-work/verify-advisor-r1-ui.mjs";
import { verifyAdvisorR2 } from "./private-work/verify-advisor-r2-ui.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pbkdf2Sync, randomBytes } from "node:crypto";
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
try {
  await mkdir("artifacts/private-work", { recursive: true });
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
    await ctx.addInitScript(() => {
      const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
      window.__cbhSyntheticKdfIterations = [];
      crypto.subtle.deriveBits = (algorithm, ...rest) => {
        if (algorithm.name === "PBKDF2") window.__cbhSyntheticKdfIterations.push(algorithm.iterations);
        return derive(algorithm, ...rest);
      };
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
    const readiness = await ctx.request.get(base + "/api/auth/readiness");
    assert.equal(readiness.status(), 200);
    assert.deepEqual(await readiness.json(), { database: "ready", passwordRuntime: "supported" });
    await verifyPublicAuthUi(page, base);
    await page.setViewportSize({width:390,height:844});
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let anonymousLegacyRequests = 0;
    let derivedLoginRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/people")) anonymousLegacyRequests++;
      if (new URL(req.url()).pathname === "/api/auth/login" && req.method() === "POST") {
        const data = req.postDataJSON();
        assert.equal(data.protocol, "cbh-pbkdf2-relief/v1");
        assert.equal(data.password, undefined);
        assert.equal(Buffer.from(data.material, "base64").length, 32);
        derivedLoginRequests++;
      }
    });
    await page.goto(base + "/injury");
    await page.getByRole("button", { name: "로그인", exact: true }).waitFor();
    assert.equal(anonymousLegacyRequests, 0, "no legacy data before login");
    await page.getByLabel("아이디", { exact: true }).fill("yvonne");
    await page
      .getByLabel("비밀번호", { exact: true })
      .fill(label === "chromium" ? password : newPassword);
    await page.getByLabel("이 기기에서 로그인 유지").check();
    await page.route("**/api/auth/login", route => route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "AUTH_PASSWORD_RUNTIME_UNSUPPORTED" }),
    }));
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "계정이나 비밀번호를 다시 등록하지 마세요" }).waitFor();
    assert.equal((await ctx.cookies()).some(c => c.name === "__Host-cbh-session"), false);
    await page.unroute("**/api/auth/login");
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
      .getByRole("heading", { name: "산재 도우미", exact: true })
      .waitFor();
    const iterations = await page.evaluate(() => window.__cbhSyntheticKdfIterations);
    assert(iterations.length >= 2 && iterations.every(n => n === 600000), "actual browser keeps 600k client KDF");
    assert(derivedLoginRequests >= 2, "browser sends only derived materials");
    // R1 exercises a real reload; assert the login-document KDF observations
    // before that reload resets window-scoped instrumentation.
    await verifyAdvisorR1(page,ctx,base,label);
    await verifyAdvisorR2(page,ctx,base,label);
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
      await page.screenshot({
        path: resolve("artifacts/private-work", `${label}-${width}.png`),
      });
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
    const card = page.locator(".record-card").filter({
      has: page.getByRole("heading", { name: "합성 할 일 " + label }),
    });
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await card.locator(".content-scroll").evaluate((n) => (n.scrollTop = 2000));
    const copy = await card.locator(".copy-button").boundingBox(),
      scroll = await card.locator(".content-scroll").boundingBox();
    assert.ok(
      copy.y >= scroll.y - 2 &&
        copy.y + copy.height <= scroll.y + scroll.height + 2,
      "copy stays within scrolled content",
    );
    const bodyBox = await card.locator(".record-body").boundingBox();
    await page.mouse.move(bodyBox.x + 12, Math.max(bodyBox.y, scroll.y) + 55);
    await page.mouse.down();
    await dialog.waitFor({ state: "visible" });
    await page.mouse.up();
    await dialog
      .locator(".editor-content-scroll")
      .evaluate((n) => (n.scrollTop = 1000));
    const editCopy = await dialog.locator(".copy-button").boundingBox(),
      editScroll = await dialog.locator(".editor-content-scroll").boundingBox();
    assert.ok(
      editCopy.y >= editScroll.y - 2 &&
        editCopy.y + editCopy.height <= editScroll.y + editScroll.height + 2,
      "copy remains visible while editing",
    );

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
    await page.goto(base + "/api/private/case/documents/oauth/callback?state=synthetic-stale&code=synthetic-only");
    await page.getByRole("status").filter({hasText:"키를 다시 등록할 필요는 없습니다"}).waitFor();
    assert.equal(new URL(page.url()).pathname,"/injury");
    assert.equal(new URL(page.url()).searchParams.has("code"),false);
    let oauthStarts = 0, syntheticConsent = "error=access_denied";
    await page.route("**/api/private/case/documents/oauth/start", async route => {
      oauthStarts++;
      await new Promise(resolve=>setTimeout(resolve,80));
      await route.continue();
    });
    await page.route("https://accounts.google.com/**", async route => {
      assert.equal(new URL(route.request().url()).pathname,"/o/oauth2/v2/auth");
      const state=new URL(route.request().url()).searchParams.get("state");
      assert(state);
      const target=base+"/api/private/case/documents/oauth/callback?state="+state+"&"+syntheticConsent;
      // WebKit cannot fulfill an intercepted navigation with a 3xx response.
      // A synthetic provider page and real link click retain the cross-site
      // top-level navigation/cookie contract without contacting Google.
      await route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:'<!doctype html><html><head><meta charset="utf-8"></head><body><a id="synthetic-oauth-cancel" href="'+target.replaceAll('&','&amp;')+'">Cancel synthetic Google consent</a></body></html>'});
    });
    const finishSyntheticConsent = async () => {
      await page.waitForURL("https://accounts.google.com/**",{waitUntil:"domcontentloaded"});
      const syntheticPage=await page.evaluate(()=>({host:location.host,charset:document.characterSet,links:document.querySelectorAll('#synthetic-oauth-cancel').length,bodyPresent:!!document.body}));
      assert.equal(syntheticPage.links,1,"Synthetic provider fixture must render before callback: "+JSON.stringify(syntheticPage));
      await page.locator("#synthetic-oauth-cancel").click();
    };
    const connectButton = () => page.getByRole("button",{name:/^Google (Drive 연결|계정 다시 연결)$/});
    await connectButton().evaluate(button=>{button.click();button.click();});
    await finishSyntheticConsent();
    await page.getByRole("status").filter({hasText:"Google Drive 연결을 취소했습니다"}).waitFor();
    assert.equal(oauthStarts,1,"rapid double click creates a single consent request");
    assert.equal(new URL(page.url()).searchParams.has("state"),false);
    syntheticConsent = "code=synthetic-code";
    await connectButton().click();
    await finishSyntheticConsent();
    await page.getByRole("status").filter({hasText:"Google 동의 절차에서 돌아왔습니다"}).waitFor();
    assert.equal(oauthStarts,2,"one fresh request for the successful retry");
    assert.equal(new URL(page.url()).searchParams.has("code"),false);
    const connected = await ctx.request.get(base+"/api/private/case/documents/status");
    const connectedStatus = await connected.json();
    assert.equal(connectedStatus.connected,true,"real local D1 callback persisted connection");
    assert.equal(connectedStatus.folderSelected,label==="webkit","new connection has no folder; later reconnection preserves selected folder");
    if (!connectedStatus.folderSelected) {
      const selected = await api("private/case/documents/folder",{folderId:"synthetic-folder"},"PUT");
      assert.equal(selected.status(),200,"local D1 folder selection verifies private provider permissions");
      await page.reload();
    }
    console.log("PRIVATE_OAUTH_LOCAL_D1_PASS "+label+" callback_cancel_success_first_connect_reconnect_folder provider=synthetic");
    await page.unroute("**/api/private/case/documents/oauth/start");
    await page.unroute("https://accounts.google.com/**");
    await page.locator("input[type=file]").first().waitFor();
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
      .getByRole("heading", { name: "산재 도우미", exact: true })
      .waitFor();
    // The authenticated shell renders before the document status/list fetch.
    // Wait for the persisted original itself; shell visibility is not a data
    // readiness barrier, especially in WebKit after reload.
    await page
      .locator(".document-list")
      .getByRole("heading", { name: "synthetic-" + label + ".pdf" })
      .waitFor({ state: "visible", timeout: 15000 });
    // A second real browser session exercises owner consent and the admin UI.
    await page.getByRole("button", { name: "접근·이력", exact: true }).click();
    await page
      .getByText("내 자료 내보내기·기획 자료 가져오기", { exact: true })
      .click();
    const seedTitle = "합성 가져오기 " + label;
    const seedFile = {
      name: "synthetic-seed.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: "cbh-case-seed/v1",
          approved: true,
          records: [
            {
              kind: "content",
              payload: {
                title: seedTitle,
                body: "합성 초안 검토",
                certainty: "reported",
                sourceIds: [],
                data: { category: "guide", medium: "none" },
              },
            },
          ],
        }),
      ),
    };
    const seedInput = page.getByLabel("검토할 기획 자료 JSON");
    const recordCount = async () =>
      (await (await ctx.request.get(base + "/api/private/case")).json()).records
        .length;
    const beforeImport = await recordCount();
    await seedInput.setInputFiles(seedFile);
    await page
      .locator(".seed-preview")
      .getByText(seedTitle, { exact: true })
      .click();
    await page
      .locator(".seed-preview")
      .getByText("합성 초안 검토", { exact: true })
      .waitFor();
    assert.equal(
      await recordCount(),
      beforeImport,
      "even approved=true in selected file cannot write before UI approval",
    );
    await page.getByRole("button", { name: "취소", exact: true }).click();
    assert.equal(
      await recordCount(),
      beforeImport,
      "cancel import preserves D1",
    );
    await seedInput.setInputFiles(seedFile);
    await seedInput.setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":"cbh-case-seed/v1","records":[]}'),
    });
    await page
      .getByText(
        "기획 자료의 형식·내용을 확인해 주세요. 저장하지 않았습니다.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "검토 완료 · 새 기록으로 저장" })
        .count(),
      0,
      "invalid replacement clears old preview",
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await seedInput.setInputFiles(seedFile);
      await page
        .getByRole("button", { name: "검토 완료 · 새 기록으로 저장" })
        .click();
      await page.locator(".seed-preview").waitFor({ state: "hidden" });
      assert.equal(
        await recordCount(),
        beforeImport + 1,
        "explicit import stores once, replay is idempotent",
      );
    }
    await page.getByLabel("함께 관리하는 목적").fill("합성 공동 관리 검증");
    await page.getByLabel("자료 보관·검토 기간").fill("격리 검증 동안");
    await page.getByLabel("관리자의 읽기·수정 허용").check();
    await page.getByRole("button", { name: "동의 설정 저장" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "저장했습니다." })
      .waitFor();
    const adminContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
    });
    const adminPage = await adminContext.newPage();
    adminPage.on("pageerror", (e) => errors.push(e.message));
    await adminPage.goto(base + "/injury");
    await adminPage.getByLabel("아이디", { exact: true }).fill("ydh1121");
    await adminPage
      .getByLabel("비밀번호", { exact: true })
      .fill(label === "chromium" ? password : newPassword);
    await adminPage
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    if (label === "chromium") {
      await adminPage
        .getByLabel("현재 비밀번호", { exact: true })
        .fill(password);
      await adminPage
        .getByLabel("새 비밀번호", { exact: true })
        .fill(newPassword);
      await adminPage.getByLabel("새 비밀번호 다시 입력").fill(newPassword);
      await adminPage
        .getByRole("button", { name: "변경 후 다시 로그인" })
        .click();
      await adminPage.getByLabel("아이디", { exact: true }).fill("ydh1121");
      await adminPage.getByLabel("비밀번호", { exact: true }).fill(newPassword);
      await adminPage
        .getByRole("button", { name: "로그인", exact: true })
        .click();
    }
    await adminPage
      .getByRole("heading", { name: "산재 도우미", exact: true })
      .waitFor();
    await adminPage.getByRole("button",{name:"내 관리함",exact:true}).click();
    await adminPage
      .getByRole("button", { name: "접근·이력", exact: true })
      .click();
    await adminPage.getByText("계산 정책과 공식 근거", { exact: true }).click();
    await adminPage.getByLabel("검증된 정책 파일 불러오기").setInputFiles({
      name: "synthetic-policy.json",
      mimeType: "application/json",
      buffer: await readFile("docs/private-work/policies/2026-confirmed.json"),
    });
    await adminPage
      .getByRole("button", { name: "검토한 정책 모두 저장" })
      .click();
    await adminPage
      .getByRole("status")
      .filter({ hasText: "정책을 저장했습니다." })
      .waitFor();
    await adminPage.screenshot({
      path: resolve("artifacts/private-work", `${label}-policy-390.png`),
    });
    await adminPage.getByRole("button", { name: "지급", exact: true }).click();
    await adminPage.getByText("예상금액·기간 계산", { exact: true }).click();
    const policySnapshot = await (
      await adminContext.request.get(base + "/api/private/case")
    ).json();
    const policySelect = adminPage.getByLabel("계산 근거", { exact: true });
    const workInjuryPolicy = policySnapshot.policies.find(
      (p) => p.key === "work_injury",
    );
    await policySelect.focus();
    await policySelect.press("ArrowDown");
    await policySelect.press("Enter");
    assert.equal(
      await policySelect.inputValue(),
      workInjuryPolicy.id,
      "native policy picker remains keyboard selectable",
    );
    assert.ok(
      (await policySelect.locator("option:checked").textContent()).includes(
        workInjuryPolicy.effectiveTo,
      ),
      "full policy effective range remains available in the picker",
    );
    await adminPage
      .getByLabel("계산 기준일", { exact: true })
      .fill("2026-10-24");
    await adminPage.getByLabel("평균임금 일액", { exact: true }).fill("100000");
    await adminPage.getByLabel("실제 취업불능 일수", { exact: true }).fill("4");
    await adminPage
      .getByRole("button", { name: "예상 계산", exact: true })
      .click();
    await adminPage.getByText("280000", { exact: true }).waitFor();
    const afterCalculation = await (
      await adminContext.request.get(base + "/api/private/case")
    ).json();
    assert.equal(
      afterCalculation.payments.length,
      policySnapshot.payments.length,
      "estimate never creates a decision or deposit",
    );
    for (const mode of ["light", "dark"]) {
      await adminPage.emulateMedia({ colorScheme: mode });
      for (const width of [375, 390, 768, 1024, 1440]) {
        await adminPage.setViewportSize({ width, height: 900 });
        await policySelect.focus();
        await adminPage.keyboard.press("Tab");
        await adminPage.keyboard.press("Shift+Tab");
        const focus = await policySelect.evaluate((el) => ({
          focused: document.activeElement === el,
          offset: getComputedStyle(el).outlineOffset,
          width: getComputedStyle(el).outlineWidth,
          style: getComputedStyle(el).outlineStyle,
        }));
        assert.deepEqual(
          focus,
          { focused: true, offset: "-3px", width: "2px", style: "solid" },
          "focus ring remains visible inside the contained field",
        );
        await adminPage.screenshot({
          path: resolve(
            "artifacts/private-work",
            `${label}-calculation-${mode}-${width}.png`,
          ),
        });
        const geometry = await adminPage.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          scrollX,
          outside: Array.from(document.querySelectorAll(".private-page *"))
            .map((el) => ({
              tag: el.tagName,
              className: el.className,
              right: el.getBoundingClientRect().right,
              width: el.getBoundingClientRect().width,
            }))
            .filter((el) => el.right > innerWidth + 1)
            .slice(0, 20),
          overflowing: Array.from(document.querySelectorAll("body *"))
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => ({
              tag: el.tagName,
              className: el.className,
              name: el.getAttribute("name"),
              label:
                el.tagName === "LABEL"
                  ? el.childNodes[0]?.textContent?.trim()
                  : null,
              width: el.getBoundingClientRect().width,
              left: el.getBoundingClientRect().left,
              client: el.clientWidth,
              scroll: el.scrollWidth,
              overflow: getComputedStyle(el).overflowX,
              display: getComputedStyle(el).display,
              closed: !!el.closest("details:not([open])"),
            }))
            .slice(0, 45),
        }));
        assert.ok(
          geometry.document <= geometry.viewport + 1,
          "populated calculation no overflow " +
            mode +
            " " +
            width +
            " " +
            JSON.stringify(geometry),
        );
      }
    }
    await page.getByLabel("관리자의 읽기·수정 허용").uncheck();
    await page.getByRole("button", { name: "동의 설정 저장" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "저장했습니다." })
      .waitFor();
    assert.equal(
      (await adminContext.request.get(base + "/api/private/case")).status(),
      403,
      "withdrawal blocks other real browser session",
    );
    await adminPage
      .getByRole("button", { name: "새로고침", exact: true })
      .click();
    await adminPage
      .getByRole("heading", { name: "열람 동의가 필요합니다" })
      .waitFor();
    assert.equal(
      await adminPage.locator(".record-card").count(),
      0,
      "revoked admin private content removed",
    );
    await adminContext.close();
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
        " responsive_375_390_768_1024_1440 login_first_change_cookie_conflict_longpress_copy_drive_verify_policy_calculation_consent_revocation_logout_back",
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
