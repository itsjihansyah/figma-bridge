#!/usr/bin/env node
// Usage:
//   figma-send <file.js>            run a script in the open Figma file
//   echo "return figma.currentPage.name" | figma-send
//   figma-send --status             is the plugin connected?
//   figma-send <file.js> --out shot.png   save a returned PNG (return node.exportAsync({format:"PNG"}))
// Env: FIGMA_BRIDGE_URL, FIGMA_BRIDGE_TOKEN
import fs from "node:fs";

const base = (process.env.FIGMA_BRIDGE_URL || "").replace(/\/$/, "");
const token = process.env.FIGMA_BRIDGE_TOKEN;
if (!base || !token) { console.error("Set FIGMA_BRIDGE_URL and FIGMA_BRIDGE_TOKEN"); process.exit(2); }

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const headers = { "content-type": "application/json", "x-bridge-token": token };

if (args[0] === "--status") {
  const r = await fetch(`${base}/status`, { headers });
  console.log(await r.text());
  process.exit(0);
}

const code = args[0] ? fs.readFileSync(args[0], "utf8") : fs.readFileSync(0, "utf8");
const r = await fetch(`${base}/run`, { method: "POST", headers, body: JSON.stringify({ code, timeoutMs: 120000 }) });
const res = await r.json();

for (const line of res.logs || []) console.error("[log]", line);
if (!res.ok) { console.error("ERROR:", res.error); process.exit(1); }

if (res.value && res.value.__png) {
  const file = out || `figma-${Date.now()}.png`;
  fs.writeFileSync(file, Buffer.from(res.value.__png, "base64"));
  console.log(JSON.stringify({ ok: true, png: file }));
} else {
  console.log(JSON.stringify({ ok: true, value: res.value }, null, 2));
}
