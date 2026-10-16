const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CONTENT_KEY = "dashboard";
const AUTH_ID = 1;

function openDatabase(dbPath) {
  if (dbPath !== ":memory:") {
    const directory = path.dirname(dbPath);
    if (directory) fs.mkdirSync(directory, { recursive: true });
  }

  const connection = new DatabaseSync(dbPath);
  connection.exec("PRAGMA journal_mode = WAL;");
  connection.exec("PRAGMA foreign_keys = ON;");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL
    );
  `);
  connection.exec(`
    CREATE TABLE IF NOT EXISTS content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  connection.exec(`
    CREATE TABLE IF NOT EXISTS media (
      name TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const statements = {
    getAuth: connection.prepare("SELECT email, salt, hash FROM auth WHERE id = ?"),
    setAuth: connection.prepare(`
      INSERT INTO auth (id, email, salt, hash) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, salt = excluded.salt, hash = excluded.hash
    `),
    getContent: connection.prepare("SELECT value FROM content WHERE key = ?"),
    setContent: connection.prepare(`
      INSERT INTO content (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    getMedia: connection.prepare("SELECT content_type, data FROM media WHERE name = ?"),
    setMedia: connection.prepare(`
      INSERT INTO media (name, content_type, data, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at
    `),
    deleteMedia: connection.prepare("DELETE FROM media WHERE name = ?")
  };

  return {
    getAuth() {
      const row = statements.getAuth.get(AUTH_ID);
      return row ? { email: row.email, salt: row.salt, hash: row.hash } : null;
    },
    setAuth({ email, salt, hash }) {
      statements.setAuth.run(AUTH_ID, email, salt, hash);
    },
    getContent() {
      const row = statements.getContent.get(CONTENT_KEY);
      return row ? JSON.parse(row.value) : null;
    },
    setContent(value) {
      statements.setContent.run(CONTENT_KEY, JSON.stringify(value));
    },
    getMedia(name) {
      const row = statements.getMedia.get(name);
      return row ? { contentType: row.content_type, data: Buffer.from(row.data) } : null;
    },
    setMedia(name, contentType, data) {
      statements.setMedia.run(name, contentType, data);
    },
    deleteMedia(name) {
      statements.deleteMedia.run(name);
    },
    close() {
      connection.close();
    }
  };
}

module.exports = { openDatabase };
