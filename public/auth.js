(function () {
  "use strict";

  var AUTH_STORE_KEY = "campusAdminAuth";
  var SESSION_KEY = "campusAdminSession";
  var SESSION_TTL_MS = 8 * 60 * 60 * 1000;
  var DEFAULT_PASSWORD = "God is good";

  function toHex(bytes) {
    return Array.prototype.map
      .call(bytes, function (byte) { return byte.toString(16).padStart(2, "0"); })
      .join("");
  }

  function randomSalt() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return toHex(bytes);
  }

  function fallbackHash(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return "fnv1a:" + (hash >>> 0).toString(16);
  }

  function hashPassword(salt, password) {
    var text = salt + ":" + password;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(text))
        .then(function (digest) { return toHex(new Uint8Array(digest)); });
    }
    return Promise.resolve(fallbackHash(text));
  }

  function readRecord() {
    try {
      return JSON.parse(window.localStorage.getItem(AUTH_STORE_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function writeRecord(record) {
    window.localStorage.setItem(AUTH_STORE_KEY, JSON.stringify(record));
  }

  function ensureRecord() {
    var record = readRecord();
    if (record && typeof record.salt === "string" && typeof record.hash === "string") {
      return Promise.resolve(record);
    }
    var salt = randomSalt();
    return hashPassword(salt, DEFAULT_PASSWORD).then(function (hash) {
      var fresh = { salt: salt, hash: hash };
      writeRecord(fresh);
      return fresh;
    });
  }

  function verifyPassword(password) {
    return ensureRecord().then(function (record) {
      return hashPassword(record.salt, String(password || "")).then(function (hash) {
        return hash === record.hash;
      });
    });
  }

  function setPassword(currentPassword, newPassword) {
    if (String(newPassword || "").length < 8) {
      return Promise.reject(new Error("The new password must contain at least 8 characters."));
    }
    return verifyPassword(currentPassword).then(function (ok) {
      if (!ok) throw new Error("The current password is incorrect.");
      var salt = randomSalt();
      return hashPassword(salt, newPassword).then(function (hash) {
        writeRecord({ salt: salt, hash: hash });
      });
    });
  }

  function startSession() {
    try {
      window.sessionStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_TTL_MS));
    } catch (error) { /* storage unavailable */ }
  }

  function hasSession() {
    var expires = 0;
    try {
      expires = Number(window.sessionStorage.getItem(SESSION_KEY)) || 0;
    } catch (error) {
      return false;
    }
    if (!expires || expires <= Date.now()) {
      endSession();
      return false;
    }
    return true;
  }

  function endSession() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) { /* storage unavailable */ }
  }

  function requireSession() {
    if (!hasSession()) {
      var page = window.location.pathname.split("/").pop() || "index.html";
      window.location.replace("admin.html?returnTo=" + encodeURIComponent(page));
      return false;
    }
    return true;
  }

  window.CampusAuth = {
    verifyPassword: verifyPassword,
    setPassword: setPassword,
    startSession: startSession,
    hasSession: hasSession,
    endSession: endSession,
    requireSession: requireSession
  };
})();
