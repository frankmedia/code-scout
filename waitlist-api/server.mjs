/**
 * Minimal public waitlist API for Code Scout marketing signups.
 * Deploy separately from the Tauri app; MySQL credentials stay server-side only.
 *
 * Env:
 *   DATABASE_URL          mysql://user:pass@host:3306/dbname
 *   PORT                  default 8787
 *   WAITLIST_CORS_ORIGINS comma-separated allowlist, or * for dev
 *   TRUST_PROXY           set to 1 if behind a reverse proxy (for rate-limit IP)
 */

import { URL } from "node:url";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import mysql from "mysql2/promise";

const PORT = Number(process.env.PORT) || 8787;
const DATABASE_URL = process.env.DATABASE_URL;

/** Canonical consent copy per version — stored server-side for audit. */
const CONSENT_BY_VERSION = {
  "2026-04-07": "Email me about the Code Scout beta and launch.",
};

function parseCorsOrigins() {
  const raw = process.env.WAITLIST_CORS_ORIGINS?.trim();
  if (!raw || raw === "*") return true;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isValidEmail(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 3 || t.length > 254) return false;
  if (t.includes(" ") || t.includes("\n")) return false;
  const at = t.indexOf("@");
  if (at < 1 || at !== t.lastIndexOf("@")) return false;
  const local = t.slice(0, at);
  const domain = t.slice(at + 1);
  if (!local || !domain || !domain.includes(".")) return false;
  if (domain.length > 253) return false;
  return true;
}

function normalizeEmail(s) {
  return String(s).trim().toLowerCase();
}

function clampStr(s, max) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

let poolPromise;

function createPoolFromDatabaseUrl(urlString) {
  const u = new URL(urlString);
  if (u.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must be a mysql:// URI");
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0] || "");
  if (!database) throw new Error("DATABASE_URL must include a database name");
  return mysql.createPool({
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });
}

function getPool() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!poolPromise) {
    poolPromise = createPoolFromDatabaseUrl(DATABASE_URL);
  }
  return poolPromise;
}

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS codescout_waitlist (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email_normalized VARCHAR(320) NOT NULL COMMENT 'lowercased, trimmed',
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  source           VARCHAR(64) NULL COMMENT 'e.g. utm_campaign or ref slug',
  landing_path     VARCHAR(512) NULL,
  consent_text     VARCHAR(512) NOT NULL COMMENT 'exact checkbox label user agreed to',
  consent_version  VARCHAR(32)  NOT NULL COMMENT 'bump when copy changes',
  consent_at       DATETIME(3)  NOT NULL,
  confirm_token_hash   CHAR(64) NULL COMMENT 'hash of token; NULL if not used',
  confirmed_at         DATETIME(3) NULL,
  invited_at       DATETIME(3) NULL,
  unsubscribed_at  DATETIME(3) NULL,
  admin_note       VARCHAR(512) NULL,
  UNIQUE KEY uq_waitlist_email (email_normalized),
  KEY idx_waitlist_created (created_at),
  KEY idx_waitlist_invited (invited_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function ensureTable() {
  const pool = getPool();
  await pool.query(ENSURE_TABLE_SQL);
}

const app = express();
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: parseCorsOrigins(),
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: "16kb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

app.post("/api/waitlist", limiter, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Honeypot: pretend success, do not store
    const hp = body.website ?? body.company ?? body._hp;
    if (hp != null && String(hp).trim() !== "") {
      return res.status(200).json({ ok: true });
    }

    if (body.consent !== true) {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }

    const version = typeof body.consentVersion === "string" ? body.consentVersion.trim() : "";
    const consentText = CONSENT_BY_VERSION[version];
    if (!consentText) {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }

    const rawEmail = body.email;
    if (!isValidEmail(rawEmail)) {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }
    const emailNorm = normalizeEmail(rawEmail);

    const source = clampStr(body.source, 64);
    const landingPath = clampStr(body.landingPath, 512);

    const consentAt = new Date();

    const pool = getPool();
    const sql = `
      INSERT INTO codescout_waitlist
        (email_normalized, source, landing_path, consent_text, consent_version, consent_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE email_normalized = email_normalized
    `;
    await pool.execute(sql, [
      emailNorm,
      source,
      landingPath,
      consentText,
      version,
      consentAt,
    ]);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[waitlist]", e);
    return res.status(500).json({ ok: false, error: "Something went wrong" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

async function main() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  await ensureTable();
  app.listen(PORT, () => {
    console.log(`Waitlist API listening on :${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
