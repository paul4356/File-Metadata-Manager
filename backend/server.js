import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 3001);
const databasePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "metadata.sqlite");
const db = new DatabaseSync(databasePath);
const sessions = new Map();
const pendingOtps = new Map();
const minimothApiKey = process.env.MINIMOTH_API_KEY;
const minimothApiUrl = "https://api.minimoth.dev/v1/otp";

db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    identity_id TEXT NOT NULL UNIQUE
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("identity_id")) db.exec("ALTER TABLE users ADD COLUMN identity_id TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_identity_id_idx ON users(identity_id)");
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(express.json({ limit: "10kb" }));

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function normalizePhone(value) {
  if (typeof value !== "string") return "";
  const phone = value.trim();
  if (/^[6-9]\d{9}$/.test(phone)) return `+91${phone}`;
  return phone;
}

function isValidPhone(phone) {
  return /^\+91[6-9]\d{9}$/.test(phone);
}

async function minimothRequest(endpoint, body) {
  if (!minimothApiKey) throw new Error("Set MINIMOTH_API_KEY in backend/.env.");

  let response;
  try {
    response = await fetch(`${minimothApiUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        "X-Api-Key": minimothApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw new Error(`Could not reach MiniMoth: ${error.message}`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof result.error === "string" ? result.error : "MiniMoth rejected the request.";
    const error = new Error(detail);
    error.status = response.status >= 500 ? 502 : response.status === 429 ? 429 : 400;
    throw error;
  }
  return result;
}

app.post("/api/auth/otp", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!isValidPhone(phone)) {
    return sendError(res, 400, "Enter an Indian mobile number in international format, for example +919876543210.");
  }

  try {
    await minimothRequest("send", { phone });
    pendingOtps.set(phone, Date.now() + 10 * 60 * 1000);
    return res.json({ message: "OTP sent. Check your WhatsApp or SMS." });
  } catch (error) {
    console.error("MiniMoth OTP send failed:", error.message);
    return sendError(res, error.status || 502, error.message);
  }
});

app.post("/api/auth/verify", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!isValidPhone(phone) || !/^\d{6}$/.test(code)) {
    return sendError(res, 400, "Enter a valid Indian mobile number and six-digit code.");
  }

  const expiresAt = pendingOtps.get(phone);
  if (!expiresAt || expiresAt < Date.now()) {
    pendingOtps.delete(phone);
    return sendError(res, 400, "Request a new code; the previous code is no longer valid.");
  }

  try {
    const result = await minimothRequest("verify", { phone, code });
    if (!result.identity_id || typeof result.identity_id !== "string") {
      console.error("MiniMoth OTP verify response did not include an identity_id.");
      return sendError(res, 502, "MiniMoth returned an incomplete verification response.");
    }

    let user = db.prepare("SELECT id FROM users WHERE identity_id = ?").get(result.identity_id);
    if (!user) {
      const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
      const fields = [];
      const values = [];
      const add = (column, value) => {
        if (columns.has(column)) {
          fields.push(column);
          values.push(value);
        }
      };
      add("identity_id", result.identity_id);
      add("auth_subject", result.identity_id);
      add("email", `${result.identity_id}@minimoth.local`);
      add("name", "Phone user");

      db.prepare(
        `INSERT OR IGNORE INTO users (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`
      ).run(...values);
      user = db.prepare("SELECT id FROM users WHERE identity_id = ?").get(result.identity_id);
    }
    if (!user) return sendError(res, 500, "Could not create your account.");

    pendingOtps.delete(phone);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    return res.json({ token, user: { phone } });
  } catch (error) {
    console.error("MiniMoth OTP verification failed:", error.message);
    return sendError(res, error.status || 502, error.message);
  }
});

function requireUser(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const userId = token ? sessions.get(token) : undefined;
  if (!userId) return sendError(res, 401, "Sign in to manage file metadata.");
  req.userId = userId;
  next();
}

app.get("/api/files", requireUser, (req, res) => {
  const files = db.prepare(`
    SELECT id, filename, size_bytes AS sizeBytes, content_type AS contentType, created_at AS createdAt
    FROM files WHERE user_id = ? ORDER BY id DESC
  `).all(req.userId);
  return res.json({ files });
});

app.post("/api/files", requireUser, (req, res) => {
  const filename = typeof req.body?.filename === "string" ? req.body.filename.trim() : "";
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.trim() : "";
  const sizeBytes = req.body?.sizeBytes;

  if (!filename || filename.length > 255) return sendError(res, 400, "Filename is required (up to 255 characters).");
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return sendError(res, 400, "Size must be a non-negative whole number of bytes.");
  if (!contentType || contentType.length > 120) return sendError(res, 400, "Content type is required (up to 120 characters).");

  const result = db.prepare(
    "INSERT INTO files (user_id, filename, size_bytes, content_type) VALUES (?, ?, ?, ?)"
  ).run(req.userId, filename, sizeBytes, contentType);
  return res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete("/api/files/:id", requireUser, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return sendError(res, 400, "Invalid file metadata ID.");
  const result = db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(id, req.userId);
  if (!result.changes) return sendError(res, 404, "File metadata not found.");
  return res.status(204).end();
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Request failed:", error.message);
  return sendError(res, 500, "The server could not complete the request.");
});

app.listen(port, () => {
  console.log(`File Metadata Manager API listening on http://localhost:${port}`);
});
