const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { openDatabase } = require("./db");

const ROOT = path.join(__dirname, "public");
const SESSION_COOKIE = "campus_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const MAX_REQUEST_BYTES = 8192;
const MAX_CONTENT_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const DEFAULT_DB_PATH = path.join(__dirname, "data", "church.db");
const PROTECTED_PAGES = new Set(["program-dashboard.html", "preachers.html"]);
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"]
]);

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("Request is too large."), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function readJson(request, maxBytes = MAX_REQUEST_BYTES) {
  return readBody(request, maxBytes).then(body => {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw Object.assign(new Error("Send a valid JSON request."), { statusCode: 400 });
    }
  });
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendMedia(request, response, media) {
  const data = media.data;
  const headers = {
    "Content-Type": media.contentType || "application/octet-stream",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes"
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) {
        response.writeHead(416, { "Content-Range": `bytes */${data.length}` }).end();
        return;
      }
      const chunk = data.subarray(start, end + 1);
      response.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Content-Length": chunk.length
      });
      response.end(request.method === "HEAD" ? undefined : chunk);
      return;
    }
  }
  response.writeHead(200, { ...headers, "Content-Length": data.length });
  response.end(request.method === "HEAD" ? undefined : data);
}

function cookieValue(request, name) {
  const cookies = (request.headers.cookie || "").split(";");
  const item = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(name + "="));
  return item ? item.slice(name.length + 1) : "";
}

function createAppServer(options = {}) {
  const adminEmail = options.adminEmail || process.env.ADMIN_EMAIL;
  const initialPassword = options.adminPassword || process.env.ADMIN_PASSWORD;
  const dbPath = options.dbPath || process.env.DATABASE_PATH || DEFAULT_DB_PATH;
  const trustProxy = options.trustProxy === undefined
    ? process.env.TRUST_PROXY === "true"
    : options.trustProxy;
  const secureCookie = options.cookieSecure === undefined
    ? process.env.COOKIE_SECURE === "true"
    : options.cookieSecure;

  if (!adminEmail) {
    throw new Error("Set ADMIN_EMAIL before starting the site.");
  }

  const database = options.database || openDatabase(dbPath);
  const ownsDatabase = !options.database;

  const savedAuth = database.getAuth();
  if (savedAuth) {
    if (typeof savedAuth.salt !== "string" || typeof savedAuth.hash !== "string" ||
        !/^[0-9a-f]+$/i.test(savedAuth.salt) || !/^[0-9a-f]+$/i.test(savedAuth.hash)) {
      throw new Error("The saved administrator credential record is invalid.");
    }
  } else {
    if (!initialPassword) {
      throw new Error("Set ADMIN_PASSWORD for the first server start.");
    }
    database.setAuth({
      email: adminEmail.trim().toLowerCase(),
      ...passwordRecord(initialPassword)
    });
  }

  const storedAuth = savedAuth || database.getAuth();
  let credentials = {
    email: storedAuth.email.trim().toLowerCase(),
    salt: storedAuth.salt,
    hash: storedAuth.hash
  };

  const sessions = new Map();
  const loginAttempts = new Map();

  function sessionCookie(value, maxAge) {
    return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
  }

  function clientAddress(request) {
    if (trustProxy) {
      const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (forwarded) return forwarded;
    }
    return request.socket.remoteAddress || "unknown";
  }

  function sessionFor(request) {
    const token = cookieValue(request, SESSION_COOKIE);
    const expiresAt = sessions.get(token);
    if (!expiresAt) return "";
    if (expiresAt <= Date.now()) {
      sessions.delete(token);
      return "";
    }
    return token;
  }

  function sameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin || !request.headers.host) return false;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  function handleApi(request, response, url) {
    const pathname = url.pathname;
    const method = request.method;

    if (method === "GET" && pathname === "/api/session") {
      sendJson(response, 200, { authenticated: Boolean(sessionFor(request)) });
      return true;
    }

    if (method === "GET" && pathname === "/api/home") {
      const content = database.getContent() || {};
      sendJson(response, 200, {
        title: typeof content.title === "string" ? content.title : "",
        homeMessages: Array.isArray(content.homeMessages) ? content.homeMessages : [],
        homePhotos: Array.isArray(content.homePhotos) ? content.homePhotos : [],
        hasVideo: Boolean(database.getMedia("homeVideo"))
      });
      return true;
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/media/video") {
      const media = database.getMedia("homeVideo");
      if (!media) {
        sendJson(response, 404, { error: "No home video has been uploaded." });
        return true;
      }
      sendMedia(request, response, media);
      return true;
    }

    if (method === "GET" && pathname === "/api/content") {
      // Allow public reading of the dashboard data.
      sendJson(response, 200, database.getContent() || {});
      return true;
    }

    if (method !== "POST" && method !== "PUT" && method !== "DELETE") return false;
    if (!["/api/login", "/api/logout", "/api/change-password", "/api/content", "/api/media/video"].includes(pathname)) {
      return false;
    }
    if (!sameOrigin(request)) {
      sendJson(response, 403, { error: "Request origin was not accepted." });
      return true;
    }
    if (pathname === "/api/logout") {
      const token = cookieValue(request, SESSION_COOKIE);
      sessions.delete(token);
      sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
      return true;
    }

    function failRequest(error) {
      if (response.headersSent || response.destroyed) return;
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Unable to process the request."
      });
      if (!error.statusCode) console.error("API request failed:", error);
    }

    if (pathname === "/api/content") {
      if (method !== "PUT") {
        response.writeHead(405, { Allow: "GET, PUT" }).end("Method not allowed.");
        return true;
      }
      if (!sessionFor(request)) {
        sendJson(response, 401, { error: "Sign in to save the dashboard data." });
        return true;
      }
      readJson(request, MAX_CONTENT_BYTES).then(data => {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          sendJson(response, 400, { error: "Send valid dashboard data." });
          return;
        }
        database.setContent(data);
        sendJson(response, 200, { ok: true });
      }).catch(failRequest);
      return true;
    }

    if (pathname === "/api/media/video") {
      if (!sessionFor(request)) {
        sendJson(response, 401, { error: "Sign in to change the home video." });
        return true;
      }
      if (method === "DELETE") {
        database.deleteMedia("homeVideo");
        sendJson(response, 200, { ok: true });
        return true;
      }
      const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      readBody(request, MAX_VIDEO_BYTES).then(body => {
        if (!contentType.startsWith("video/")) {
          sendJson(response, 400, { error: "Upload a supported video file." });
          return;
        }
        if (!body.length) {
          sendJson(response, 400, { error: "Choose a video before saving." });
          return;
        }
        database.setMedia("homeVideo", contentType, body);
        sendJson(response, 200, { ok: true });
      }).catch(failRequest);
      return true;
    }

    readJson(request).then(data => {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        sendJson(response, 400, { error: "Send valid login details." });
        return;
      }

      if (pathname === "/api/login") {
        const address = clientAddress(request);
        const attempts = loginAttempts.get(address) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
        if (attempts.resetAt <= Date.now()) {
          attempts.count = 0;
          attempts.resetAt = Date.now() + 15 * 60 * 1000;
        }
        if (attempts.count >= 10) {
          loginAttempts.set(address, attempts);
          sendJson(response, 429, { error: "Too many login attempts. Try again later." });
          return;
        }

        const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
        const password = typeof data.password === "string" ? data.password : "";
        if (email !== credentials.email || !verifyPassword(password, credentials)) {
          attempts.count += 1;
          loginAttempts.set(address, attempts);
          sendJson(response, 401, { error: "Incorrect email or password." });
          return;
        }

        loginAttempts.delete(address);
        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, Date.now() + SESSION_DURATION_MS);
        sendJson(response, 200, { ok: true }, {
          "Set-Cookie": sessionCookie(token, Math.floor(SESSION_DURATION_MS / 1000))
        });
        return;
      }

      if (!sessionFor(request)) {
        sendJson(response, 401, { error: "Sign in to change the administrator password." });
        return;
      }
      const currentPassword = typeof data.currentPassword === "string" ? data.currentPassword : "";
      const newPassword = typeof data.newPassword === "string" ? data.newPassword : "";
      if (!verifyPassword(currentPassword, credentials)) {
        sendJson(response, 401, { error: "The current password is incorrect." });
        return;
      }
      if (newPassword.length < 12) {
        sendJson(response, 400, { error: "The new password must contain at least 12 characters." });
        return;
      }

      const nextCredentials = {
        email: credentials.email,
        ...passwordRecord(newPassword)
      };
      database.setAuth({
        email: nextCredentials.email,
        salt: nextCredentials.salt,
        hash: nextCredentials.hash
      });
      credentials = nextCredentials;
      sessions.clear();
      sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    }).catch(failRequest);
    return true;
  }

  const server = http.createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");

    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      response.writeHead(400).end("Invalid request URL.");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (handleApi(request, response, url)) return;
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed.");
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end("Invalid request path.");
      return;
    }
    const relativePath = pathname.replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(ROOT, relativePath);
    const hiddenSegment = path.relative(ROOT, filePath).split(path.sep)
      .some(part => part.startsWith(".") || part === "node_modules");
    if (!filePath.startsWith(ROOT + path.sep) || hiddenSegment ||
        !MIME_TYPES.has(path.extname(filePath).toLowerCase())) {
      response.writeHead(404).end("Not found.");
      return;
    }

    const page = path.basename(filePath);
    if (PROTECTED_PAGES.has(page) && !sessionFor(request)) {
      response.writeHead(302, {
        Location: `admin.html?returnTo=${encodeURIComponent(page)}`,
        "Cache-Control": "no-store"
      }).end();
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        // If the requested file is the site logo and it's missing, serve a small built-in JPEG.
        if (error.code === "ENOENT" && path.basename(filePath) === "church-logo.jpg") {
          const jpeg = Buffer.from(
            // 1x1 white JPEG
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf////////////////////////////////////////////////////////[...]"
            ,
            "base64"
          );
          response.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-cache"
          });
          response.end(request.method === "HEAD" ? undefined : jpeg);
          return;
        }
        response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Cache-Control": "no-store" });
        response.end(error.code === "ENOENT" ? "Not found." : "Unable to read the requested page.");
        if (error.code !== "ENOENT") console.error("Unable to serve page:", error);
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()),
        "Cache-Control": PROTECTED_PAGES.has(page) ? "no-store" : "no-cache"
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    });
  });

  if (ownsDatabase) {
    server.on("close", () => database.close());
  }
  server.database = database;

  return server;
}

if (require.main === module) {
  try {
    const server = createAppServer();
    const port = Number(process.env.PORT) || 4010;
    server.on("error", error => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Stop the other site server or set PORT to a free port.`);
      } else {
        console.error("Unable to start the site server:", error.message);
      }
      process.exitCode = 1;
    });
    server.listen(port, "0.0.0.0", () => {
      console.log(`Church programs site listening on port ${port}.`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createAppServer };
