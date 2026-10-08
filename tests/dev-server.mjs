/* Local practice server: the real pages + the real Worker code + the real Code.gs on an in-memory sheet.
   node tests/dev-server.mjs  ->  http://localhost:8788/?c=RR  and  /ba.html  and  /report.html */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { handleApi } from "../worker/src/index.js";
const require = createRequire(import.meta.url);
const { loadGateway } = require("./fake-apps-script.cjs");

export function startDevServer(port = 8788, opts = {}) {
  const gw = loadGateway({ now: opts.now });
  if (opts.testMode === false) gw.setSetting("TEST_MODE", "NO");
  const env = { GATEWAY_URL: "https://script.example/exec", GATEWAY_SECRET: gw.secret, ...(opts.minimalSecrets ? {} : { SESSION_SECRET: "dev-session-secret-0123456789", REPORT_PASSCODE: "client2026" }) };
  const fakeFetch = async (_url, init) => new Response(JSON.stringify(gw.post(JSON.parse(init.body))), { headers: { "Content-Type": "application/json" } });
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost:" + port);
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const r = await handleApi(request, env, { fetch: fakeFetch });
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, () => r({ server, gw, env })));
}

if (process.argv[1] && process.argv[1].endsWith("dev-server.mjs")) {
  const { gw } = await startDevServer(Number(process.env.PORT) || 8788);
  console.log("Dev server on http://localhost:" + (process.env.PORT || 8788) + "  PINs: PM01=" + gw.pinOf("PM01") + " JA01=" + gw.pinOf("JA01") + "  report passcode: client2026");
}
