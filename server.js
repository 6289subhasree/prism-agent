const express = require("express");
const path = require("path");
const { spawn } = require("child_process");

// Keep local credentials out of source control while making `npm run dev`
// behave the same as a shell where GEMINI_API_KEY was exported explicitly.
// Existing process variables win; a missing .env is fine.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const app = express();
const PORT = Number(process.env.PRISM_PORT || 8787);
const FINAL_MARKER = "=== FINAL REPORT (pending human review before publishing) ===";
const controllerNode = process.env.PRISM_CONTROLLER_NODE || process.execPath;

app.use(express.json({ limit: "16kb" }));

function parsePublicUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return null;
    if (/^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "prism-bridge" }));

app.post("/api/investigate", (req, res) => {
  const target = parsePublicUrl(req.body?.url);
  if (!target) return res.status(400).json({ error: "Enter a valid public http(s) URL." });

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.flushHeaders();

  const send = (payload) => res.write(`${JSON.stringify(payload)}\n`);
  send({ type: "started", url: target, at: new Date().toISOString() });

  const child = spawn(controllerNode, [path.join(__dirname, "agent", "controller.js"), target], {
    cwd: __dirname,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let lineBuffer = "";
  const seen = new Set();
  const phase = (id, label, detail) => {
    if (!seen.has(id)) { seen.add(id); send({ type: "phase", id, label, detail }); }
  };
  const inspectLine = (line) => {
    if (line.includes("[OBSERVE]")) phase("observe-1", "OBSERVE", "Inspecting the live page, DOM and network activity");
    if (line.includes("[DECIDE]")) phase("decide", "DECIDE", "Evaluating whether the evidence warrants a deeper pass");
    if (line.includes("DEEP_INVESTIGATION")) phase("act", "ACT", "Deeper investigation selected — scrolling the same browser session");
    if (line.includes("Phase 2 found")) phase("observe-2", "OBSERVE", "Capturing activity revealed after interaction");
    if (line.includes("[SCORE]")) phase("score", "SCORE", "Applying the deterministic evidence rubric");
    if (line.includes("[EXPLAIN]")) phase("explain", "EXPLAIN", "Narrating the already-computed result");
  };

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString(); stdout += text; lineBuffer += text;
    const lines = lineBuffer.split(/\r?\n/); lineBuffer = lines.pop() || "";
    lines.forEach(inspectLine);
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  res.on("close", () => { if (!res.writableEnded && !child.killed) child.kill(); });

  child.on("error", (error) => { send({ type: "error", error: `Investigation service could not start: ${error.message}` }); res.end(); });
  child.on("close", (code) => {
    if (res.writableEnded) return;
    if (lineBuffer) inspectLine(lineBuffer);
    if (code !== 0) {
      const clean = stderr.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
      send({ type: "error", error: clean || "The browser investigation did not complete." });
      return res.end();
    }
    try {
      const marker = stdout.indexOf(FINAL_MARKER);
      if (marker < 0) throw new Error("Final report marker missing");
      const jsonStart = stdout.indexOf("{", marker + FINAL_MARKER.length);
      const report = JSON.parse(stdout.slice(jsonStart));
      send({ type: "complete", report });
    } catch (error) {
      send({ type: "error", error: `The investigation completed but its report could not be read: ${error.message}` });
    }
    res.end();
  });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, "127.0.0.1", () => console.log(`PRISM bridge listening on http://127.0.0.1:${PORT}`));
