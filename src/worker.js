import { ORG_NAME, ZIP_ROOT, MEMBERS, DOCUMENTS, MAX_FILE_BYTES, ALLOWED_TYPES } from "./config.js";

// Secrets requeridos (se capturan en Cloudflare, nunca en el código):
//   PIN_GENERAL     PIN compartido para los miembros del consejo
//   PIN_ADMIN       PIN de administrador (ver, descargar y borrar)
//   SESSION_SECRET  cadena aleatoria larga para firmar la sesión
// Binding R2: DOCS

const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const memberById = Object.fromEntries(MEMBERS.map((m) => [m.id, m]));
const docById = Object.fromEntries(DOCUMENTS.map((d) => [d.id, d]));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      const res = await route(request, env, url);
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("X-Content-Type-Options", "nosniff");
      return res;
    } catch (err) {
      console.error(err);
      return json({ error: "Error interno. Intenta de nuevo." }, 500);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  // Diagnóstico público: solo dice si cada pieza existe, nunca su valor.
  if (pathname === "/api/health") {
    let r2 = false;
    try { await env.DOCS.head("health-check"); r2 = true; } catch {}
    return json({
      PIN_GENERAL: !!env.PIN_GENERAL,
      PIN_ADMIN: !!env.PIN_ADMIN,
      SESSION_SECRET: !!env.SESSION_SECRET,
      R2: r2,
    });
  }

  if (!env.PIN_GENERAL || !env.PIN_ADMIN || !env.SESSION_SECRET) {
    return json({ error: "El portal no está configurado: faltan los secrets PIN_GENERAL, PIN_ADMIN o SESSION_SECRET." }, 503);
  }

  if (pathname === "/api/login" && method === "POST") return login(request, env);
  if (pathname === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }

  const role = await readSession(request, env);
  if (!role) return json({ error: "Sesión expirada. Vuelve a ingresar el PIN." }, 401);

  // Toda escritura debe venir del mismo sitio.
  if (method !== "GET" && !sameOrigin(request, url)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  if (pathname === "/api/me" && method === "GET") return json({ role });
  if (pathname === "/api/status" && method === "GET") return status(env, role);
  if (pathname === "/api/wipe" && method === "POST") {
    if (role !== "admin") return forbidden();
    return wipe(env);
  }

  const m = pathname.match(/^\/api\/files\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (m) {
    const [, memberId, docId] = m;
    if (!memberById[memberId] || !docById[docId]) return json({ error: "Socio o documento desconocido." }, 404);
    const key = `docs/${memberId}/${docId}`;
    if (method === "PUT") return upload(request, env, key);
    if (method === "DELETE") {
      await env.DOCS.delete(key);
      return json({ ok: true });
    }
    if (method === "GET") {
      if (role !== "admin") return forbidden();
      return download(env, key, memberId, docId, url.searchParams.has("inline"));
    }
  }

  return json({ error: "No encontrado." }, 404);
}

// ---------- Sesión ----------

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const lockKey = `_ratelimit/${await sha256(ip)}`;
  const lockObj = await env.DOCS.get(lockKey);
  let lock = lockObj ? await lockObj.json() : { fails: 0, until: 0 };
  const now = Date.now();
  if (lock.until > now) {
    const min = Math.ceil((lock.until - now) / 60000);
    return json({ error: `Demasiados intentos. Espera ${min} min.` }, 429);
  }

  let body = {};
  try { body = await request.json(); } catch {}
  const pin = String(body.pin || "").trim();
  const wantAdmin = body.admin === true;

  let role = null;
  if (wantAdmin) {
    if (await safeEqual(pin, env.PIN_ADMIN, env.SESSION_SECRET)) role = "admin";
  } else if (await safeEqual(pin, env.PIN_ADMIN, env.SESSION_SECRET)) {
    role = "admin";
  } else if (await safeEqual(pin, env.PIN_GENERAL, env.SESSION_SECRET)) {
    role = "member";
  }

  if (!role) {
    lock.fails = (lock.until && lock.until <= now ? 0 : lock.fails) + 1;
    lock.until = lock.fails >= MAX_FAILS ? now + LOCK_MINUTES * 60000 : 0;
    if (lock.until) lock.fails = 0;
    await env.DOCS.put(lockKey, JSON.stringify(lock));
    return json({ error: wantAdmin ? "PIN de administrador incorrecto." : "PIN incorrecto." }, 401);
  }

  if (lockObj) await env.DOCS.delete(lockKey);
  const exp = now + SESSION_HOURS * 3600 * 1000;
  const token = `${role}.${exp}.${await hmac(`${role}.${exp}`, env.SESSION_SECRET)}`;
  return json({ role }, 200, { "Set-Cookie": cookie(token, SESSION_HOURS * 3600) });
}

async function readSession(request, env) {
  const raw = (request.headers.get("Cookie") || "")
    .split(";").map((c) => c.trim()).find((c) => c.startsWith("s="));
  if (!raw) return null;
  const [role, exp, sig] = raw.slice(2).split(".");
  if (!role || !exp || !sig) return null;
  if (role !== "admin" && role !== "member") return null;
  if (Number(exp) < Date.now()) return null;
  const expected = await hmac(`${role}.${exp}`, env.SESSION_SECRET);
  return timingSafe(sig, expected) ? role : null;
}

function cookie(value, maxAge) {
  return `s=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === url.origin;
  const site = request.headers.get("Sec-Fetch-Site");
  return !site || site === "same-origin";
}

// ---------- Datos ----------

async function status(env, role) {
  const files = {};
  let cursor;
  do {
    const page = await env.DOCS.list({ prefix: "docs/", cursor, include: ["customMetadata", "httpMetadata"] });
    for (const obj of page.objects) {
      const [, memberId, docId] = obj.key.split("/");
      (files[memberId] ||= {})[docId] = {
        size: obj.size,
        uploaded: obj.uploaded,
        ext: obj.customMetadata?.ext || "",
        originalName: obj.customMetadata?.originalName || "",
      };
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return json({ role, org: ORG_NAME, zipRoot: ZIP_ROOT, members: MEMBERS, documents: DOCUMENTS, maxFileBytes: MAX_FILE_BYTES, files });
}

async function upload(request, env, key) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const ext = ALLOWED_TYPES[type];
  if (!ext) return json({ error: "Formato no permitido. Sube PDF, JPG, PNG, HEIC o WEBP." }, 415);

  const len = Number(request.headers.get("Content-Length") || 0);
  if (!len) return json({ error: "El archivo está vacío." }, 400);
  if (len > MAX_FILE_BYTES) return json({ error: `El archivo pesa más de ${MAX_FILE_BYTES / 1048576} MB.` }, 413);

  let originalName = "";
  try { originalName = decodeURIComponent(request.headers.get("X-Filename") || "").slice(0, 200); } catch {}

  await env.DOCS.put(key, request.body, {
    httpMetadata: { contentType: type },
    customMetadata: { ext, originalName },
  });
  return json({ ok: true });
}

async function download(env, key, memberId, docId, inline) {
  const obj = await env.DOCS.get(key);
  if (!obj) return json({ error: "Archivo no encontrado." }, 404);
  const name = `${slug(memberById[memberId].name)}_${slug(docById[docId].name)}.${obj.customMetadata?.ext || "bin"}`;
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Content-Length": String(obj.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    },
  });
}

async function wipe(env) {
  let cursor, count = 0;
  do {
    const page = await env.DOCS.list({ prefix: "docs/", cursor });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) { await env.DOCS.delete(keys); count += keys.length; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ ok: true, deleted: count });
}

// ---------- Utilidades ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function forbidden() {
  return json({ error: "Solo el administrador puede hacer esto." }, 403);
}

function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const enc = new TextEncoder();

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compara PINs sin filtrar tiempos: compara sus HMAC.
async function safeEqual(a, b, secret) {
  if (!a || !b) return false;
  return timingSafe(await hmac(a, secret), await hmac(b, secret));
}

function timingSafe(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
