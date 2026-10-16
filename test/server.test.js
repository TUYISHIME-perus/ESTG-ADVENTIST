const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { after, before, test } = require("node:test");
const { createAppServer } = require("../server");
const { openDatabase } = require("../db");

const originalPassword = "original-test-password";
const replacementPassword = "replacement-test-password";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "campus-auth-"));
const dbPath = path.join(temporaryDirectory, "church.db");
const server = createAppServer({
  adminEmail: "admin@example.com",
  adminPassword: originalPassword,
  dbPath
});
let baseUrl;

before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function post(pathname, details, cookie) {
  return fetch(baseUrl + pathname, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(details)
  });
}

test("protected pages are served only after server-side login", async () => {
  const probe = openDatabase(dbPath);
  const stored = probe.getAuth();
  probe.close();
  assert.equal(stored.hash.includes(originalPassword), false);

  const blocked = await fetch(baseUrl + "/program-dashboard.html", { redirect: "manual" });
  assert.equal(blocked.status, 302);
  assert.match(blocked.headers.get("location"), /admin\.html\?returnTo=program-dashboard\.html/);

  const rejectedLogin = await post("/api/login", {
    email: "admin@example.com",
    password: "incorrect-password"
  });
  assert.equal(rejectedLogin.status, 401);

  const login = await post("/api/login", {
    email: "admin@example.com",
    password: originalPassword
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);

  const allowed = await fetch(baseUrl + "/program-dashboard.html", {
    headers: { Cookie: cookie }
  });
  assert.equal(allowed.status, 200);
  assert.match(await allowed.text(), /Program Dashboard/);
});

test("password changes save only a password hash and invalidate sessions", async () => {
  const login = await post("/api/login", {
    email: "admin@example.com",
    password: originalPassword
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const change = await post("/api/change-password", {
    currentPassword: originalPassword,
    newPassword: replacementPassword
  }, cookie);
  assert.equal(change.status, 200);

  const probe = openDatabase(dbPath);
  const stored = probe.getAuth();
  probe.close();
  assert.equal(stored.hash.includes(originalPassword), false);
  assert.equal(stored.hash.includes(replacementPassword), false);
  assert.doesNotThrow(() => {
    const reopened = createAppServer({ adminEmail: "admin@example.com", dbPath });
    reopened.database.close();
  });

  const oldLogin = await post("/api/login", {
    email: "admin@example.com",
    password: originalPassword
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await post("/api/login", {
    email: "admin@example.com",
    password: replacementPassword
  });
  assert.equal(newLogin.status, 200);
});

test("dashboard content and home media persist in the database", async () => {
  const login = await post("/api/login", {
    email: "admin@example.com",
    password: replacementPassword
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const dashboard = {
    title: "Test dashboard",
    names: {},
    weeklyStudies: ["First", "", "", "", "", ""],
    homeMessages: ["Welcome", "Peace"],
    homePhotos: [],
    data: {
      morning: [{ id: "1", leader: "James", date: "2026-10-14", preacher: "Peter" }],
      worship: [],
      sabbath: []
    }
  };

  const unauthorized = await fetch(baseUrl + "/api/content", {
    method: "PUT",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify(dashboard)
  });
  assert.equal(unauthorized.status, 401);

  const saved = await fetch(baseUrl + "/api/content", {
    method: "PUT",
    headers: { Origin: baseUrl, "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(dashboard)
  });
  assert.equal(saved.status, 200);

  const loaded = await fetch(baseUrl + "/api/content", { headers: { Cookie: cookie } });
  assert.equal(loaded.status, 200);
  assert.deepEqual(await loaded.json(), dashboard);

  const home = await (await fetch(baseUrl + "/api/home")).json();
  assert.deepEqual(home.homeMessages, ["Welcome", "Peace"]);
  assert.equal(home.hasVideo, false);

  const upload = await fetch(baseUrl + "/api/media/video", {
    method: "PUT",
    headers: { Origin: baseUrl, "Content-Type": "video/mp4", Cookie: cookie },
    body: Buffer.from("fake-video-bytes")
  });
  assert.equal(upload.status, 200);

  const video = await fetch(baseUrl + "/api/media/video");
  assert.equal(video.status, 200);
  assert.match(video.headers.get("content-type"), /^video\/mp4/);
  assert.equal(Buffer.from(await video.arrayBuffer()).toString(), "fake-video-bytes");

  const head = await fetch(baseUrl + "/api/media/video", { method: "HEAD" });
  assert.equal(head.status, 200);

  const homeWithVideo = await (await fetch(baseUrl + "/api/home")).json();
  assert.equal(homeWithVideo.hasVideo, true);

  const removed = await fetch(baseUrl + "/api/media/video", {
    method: "DELETE",
    headers: { Origin: baseUrl, Cookie: cookie }
  });
  assert.equal(removed.status, 200);
  assert.equal((await fetch(baseUrl + "/api/media/video")).status, 404);
});

test("server implementation and database files are not publicly served", async () => {
  const serverSource = await fetch(baseUrl + "/server.js");
  assert.equal(serverSource.status, 404);
  const databaseFile = await fetch(baseUrl + "/data/church.db");
  assert.equal(databaseFile.status, 404);
  const loginPage = await fetch(baseUrl + "/admin.html");
  const loginMarkup = await loginPage.text();
  assert.equal(loginMarkup.includes("admin@example.com"), false);
  assert.equal(loginMarkup.includes(originalPassword), false);
});

test("site pages and all inline scripts are valid", async () => {
  const pageNames = fs.readdirSync(path.join(__dirname, "..", "public"))
    .filter(name => name.endsWith(".html"));
  const faviconResponse = await fetch(baseUrl + "/church-logo.jpg");
  assert.equal(faviconResponse.status, 200);
  assert.match(faviconResponse.headers.get("content-type"), /^image\/jpeg/);

  for (const pageName of pageNames) {
    const pageSource = fs.readFileSync(path.join(__dirname, "..", "public", pageName), "utf8");
    assert.match(pageSource, /<link rel="icon" href="church-logo\.jpg" type="image\/jpeg">/, `${pageName} should use the church logo as its browser tab icon`);
    const expectedStatus = ["preachers.html", "program-dashboard.html"].includes(pageName) ? 302 : 200;
    const route = "/" + encodeURIComponent(pageName);
    const response = await fetch(baseUrl + route, { redirect: "manual" });
    assert.equal(response.status, expectedStatus, `${pageName} should be served or protected`);

    for (const [index, script] of [...pageSource.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
      assert.doesNotThrow(
        () => new vm.Script(script[1], { filename: `${pageName} inline script ${index + 1}` }),
        `${pageName} inline script ${index + 1} should parse`
      );
    }

    for (const [, href] of pageSource.matchAll(/href="([^"]+)"/g)) {
      if (/^(?:[a-z]+:|#|\/\/)/i.test(href)) continue;
      const localTarget = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      if (localTarget) {
        assert.ok(fs.existsSync(path.join(__dirname, "..", "public", localTarget)), `${pageName} link should resolve: ${href}`);
      }
    }

    assert.match(pageSource, /<a href="https:\/\/www\.academia\.edu\/123429509\/Indirimbo_Zo_Guhimbaza_Imana_za_500_SDA_Church_500_"[^>]*>Songs of praise of God<\/a>/, `${pageName} should link to Songs of praise of God`);
    assert.match(pageSource, /<a href="https:\/\/bibiliya\.com\/"[^>]*>Holy bible<\/a>/, `${pageName} should link to the Holy Bible`);
  }
});
