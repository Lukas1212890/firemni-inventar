export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type,X-File-Name",
      "Access-Control-Expose-Headers": "X-File-Name,Content-Type",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
    });

    const auth = request.headers.get("Authorization") || "";
    if (!env.API_TOKEN || auth !== `Bearer ${env.API_TOKEN}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      await ensureSchema(env.DB);

      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, d1: true, r2: true });
      }

      if (url.pathname === "/api/state" && request.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT revision, data, updated_at FROM app_state WHERE id = 1"
        ).first();
        if (!row || row.data === null) {
          return json({ initialized: false, revision: Number(row?.revision || 0), data: null });
        }
        return json({
          initialized: true,
          revision: Number(row.revision || 0),
          updatedAt: row.updated_at,
          data: JSON.parse(row.data)
        });
      }

      if (url.pathname === "/api/state" && request.method === "PUT") {
        const body = await request.json();
        if (!body || typeof body.data !== "object") return json({ error: "Invalid data" }, 400);

        const current = await env.DB.prepare(
          "SELECT revision, data FROM app_state WHERE id = 1"
        ).first();
        const currentRevision = Number(current?.revision || 0);
        const force = body.revision === null || body.revision === undefined;

        if (!force && Number(body.revision) !== currentRevision) {
          return json({ error: "Revision conflict", revision: currentRevision }, 409);
        }

        const nextRevision = currentRevision + 1;
        const updatedAt = new Date().toISOString();
        await env.DB.prepare(
          "UPDATE app_state SET revision = ?, data = ?, updated_at = ? WHERE id = 1"
        ).bind(nextRevision, JSON.stringify(body.data), updatedAt).run();

        return json({ ok: true, revision: nextRevision, updatedAt });
      }

      if (url.pathname.startsWith("/api/files/")) {
        const key = decodeURIComponent(url.pathname.slice("/api/files/".length));
        if (!key) return json({ error: "Missing key" }, 400);

        if (request.method === "PUT") {
          const rawName = request.headers.get("X-File-Name") || "soubor";
          let fileName = rawName;
          try { fileName = decodeURIComponent(rawName); } catch {}
          const contentType = request.headers.get("Content-Type") || "application/octet-stream";
          await env.FILES.put(key, request.body, {
            httpMetadata: { contentType },
            customMetadata: { fileName }
          });
          return json({ ok: true, key });
        }

        if (request.method === "GET") {
          const object = await env.FILES.get(key);
          if (!object) return json({ error: "Not found" }, 404);
          const headers = new Headers(cors);
          object.writeHttpMetadata(headers);
          headers.set("etag", object.httpEtag);
          headers.set("X-File-Name", encodeURIComponent(object.customMetadata?.fileName || "soubor"));
          return new Response(object.body, { headers });
        }

        if (request.method === "DELETE") {
          await env.FILES.delete(key);
          return json({ ok: true });
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "Server error", message: String(error?.message || error) }, 500);
    }
  }
};

async function ensureSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO app_state (id, revision, data, updated_at)
    VALUES (1, 0, NULL, datetime('now'));
  `);
}
