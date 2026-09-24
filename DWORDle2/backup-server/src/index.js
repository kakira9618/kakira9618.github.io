// DWORDle 2 のプレイデータバックアップ用 Cloudflare Worker（D1 に保存）。
//
// POST /backup                    ゲームから。暗号化済みの封筒を 1 人 1 日 1 枠で保存（同日は上書き）
// GET  /admin/backups/:id         管理者用。その人の世代一覧
// GET  /admin/backups/:id/:day    管理者用。1 世代の封筒をそのまま返す
//
// サーバーは中身を復号できない（鍵はプレイヤー ID から作られ、ここへは ID の SHA-256 しか来ない）。
// 復号は管理者の手元で tools/fetch-backup.mjs が行う。

export const LIMITS = {
  maxBodyBytes: 1_000_000, // D1 の 1 値の上限（約 2MB）より十分小さく
  keepSlots: 30, // 1 人あたりに残す世代数（日付の新しい順）
  minRewriteSec: 60, // 同じ枠の上書きはこれだけ空ける（連打よけ）
  maxDaySkew: 2, // 受け付ける日付の、サーバー時刻（UTC）からのずれ（日）
};

const SLOT_RE = /^[0-9a-f]{64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);

export function validateEnvelope(envelope, nowMs = Date.now()) {
  if (!envelope || typeof envelope !== "object") return "not an object";
  if (envelope.v !== 1) return "bad version";
  if (!SLOT_RE.test(envelope.id ?? "")) return "bad id";
  if (!DAY_RE.test(envelope.day ?? "") || Number.isNaN(dayNumber(envelope.day))) return "bad day";
  if (Math.abs(dayNumber(envelope.day) - Math.floor(nowMs / 86400000)) > LIMITS.maxDaySkew) return "day out of range";
  if (envelope.c !== "gzip" && envelope.c !== "none") return "bad compression";
  if (typeof envelope.iv !== "string" || envelope.iv.length !== 16 || !B64_RE.test(envelope.iv)) return "bad iv";
  if (typeof envelope.data !== "string" || envelope.data.length < 24 || !B64_RE.test(envelope.data)) return "bad data";
  return null;
}

async function handleBackup(request, env) {
  const cors = corsHeaders(request, env);
  // ブラウザ以外からの雑な投稿を減らす（Origin は偽装できるので防御にはならない）
  if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin not allowed" }, 403);
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > LIMITS.maxBodyBytes) return json({ error: "too large" }, 413, cors);
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) return json({ error: "too large" }, 413, cors);
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return json({ error: "bad json" }, 400, cors);
  }
  const problem = validateEnvelope(envelope);
  if (problem) return json({ error: problem }, 400, cors);

  const now = Math.floor(Date.now() / 1000);
  // 保存するのは検証済みのフィールドだけ（余計なキーは捨てる）
  const body = JSON.stringify({ v: 1, id: envelope.id, day: envelope.day, c: envelope.c, iv: envelope.iv, data: envelope.data });
  const [upsert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO backups (id, day, created_at, size, body) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (id, day) DO UPDATE SET created_at = excluded.created_at, size = excluded.size, body = excluded.body
       WHERE backups.created_at <= ?6`
    ).bind(envelope.id, envelope.day, now, body.length, body, now - LIMITS.minRewriteSec),
    env.DB.prepare(
      `DELETE FROM backups WHERE id = ?1 AND day NOT IN
         (SELECT day FROM backups WHERE id = ?1 ORDER BY day DESC LIMIT ?2)`
    ).bind(envelope.id, LIMITS.keepSlots),
  ]);
  if (!upsert.meta?.changes) return json({ error: "too soon" }, 429, cors);
  return json({ ok: true }, 200, cors);
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// トークンは両方をハッシュしてから全バイト比較する（長さ・一致位置で時間が変わらないように）
async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const given = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [a, b] = await Promise.all([sha256(given), sha256(env.ADMIN_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 && given.length > 0;
}

async function handleAdmin(request, env, parts) {
  if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401);
  const [id, day] = parts;
  if (!SLOT_RE.test(id ?? "")) return json({ error: "bad id" }, 400);
  if (day === undefined) {
    const { results } = await env.DB.prepare(
      "SELECT day, created_at AS createdAt, size FROM backups WHERE id = ?1 ORDER BY day DESC"
    ).bind(id).all();
    return json({ id, backups: results });
  }
  if (!DAY_RE.test(day)) return json({ error: "bad day" }, 400);
  const row = await env.DB.prepare("SELECT body FROM backups WHERE id = ?1 AND day = ?2").bind(id, day).first();
  if (!row) return json({ error: "not found" }, 404);
  return new Response(row.body, { headers: { "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (request.method === "POST" && url.pathname === "/backup") return await handleBackup(request, env);
      if (request.method === "GET" && parts[0] === "admin" && parts[1] === "backups") {
        return await handleAdmin(request, env, parts.slice(2));
      }
      if (request.method === "GET" && url.pathname === "/") return json({ ok: true, service: "dwordle2-backup" });
      return json({ error: "not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "internal error" }, 500, corsHeaders(request, env));
    }
  },
};
