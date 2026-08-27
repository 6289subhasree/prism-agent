// agent/controller.js
// Usage: node agent/controller.js https://example.com
//
// LOOP:
//   1) OBSERVE  — webcmd runs webcmd/explore.js  (phase 1, always)
//   2) DECIDE   — deterministic decision policy: does the evidence justify a deeper pass?
//   3) ACT      — if yes, webcmd runs webcmd/interact.js (phase 2, scroll + longer wait,
//                 continuing on the SAME page/session opened in phase 1)
//   4) OBSERVE  — merge phase 1 + phase 2 evidence
//   5) SCORE    — deterministic scorer.js (no LLM involved)
//   6) EXPLAIN  — Gemini narrates the already-computed score, does NOT invent it
//   7) HUMAN REVIEW — final report is marked as requiring approval before publishing

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { scoreEvidence } = require("../evidence/scorer");

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

// Hard ceiling on the whole investigation (not just one browser op) so a
// stuck/misbehaving site can't hang a live demo indefinitely.
//
// NOTE: execFileSync() below is a synchronous, blocking call. A
// Promise.race() around the outer async function (see investigate())
// CANNOT preempt it — the event loop can't run the race's setTimeout
// while a sync call is blocking it, so a hung `webcmd` child process
// would hang past this "ceiling" indefinitely. The actual enforcement
// happens via execFileSync's own `timeout` option, budgeted per-call
// against a shared deadline below.
const MAX_INVESTIGATION_TIME_MS = 90000;
const GEMINI_MODEL = "gemini-3.7-flash";
const GEMINI_TIMEOUT_MS = 25000;

// Cleanup (closing the session) always gets a small fixed budget of its
// own, even if the investigation budget is already exhausted — otherwise
// a timed-out run leaks the browser session.
const SESSION_CLOSE_TIMEOUT_MS = 5000;

function assertValidUrl(url) {
  if (typeof url !== "string" || !URL_PATTERN.test(url)) {
    throw new Error(`Refusing to investigate - not a valid http(s) URL: ${url}`);
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error(`Refusing to investigate - not a valid http(s) URL: ${url}`);
  }
}

function webcmdExecutable() {
  const packageEntry = path.join(path.dirname(process.execPath), "node_modules", "@agentrhq", "webcmd", "dist", "src", "main.js");
  if (fs.existsSync(packageEntry)) {
    return { executable: process.execPath, prefixArgs: [packageEntry] };
  }
  return { executable: process.platform === "win32" ? "webcmd.cmd" : "webcmd", prefixArgs: [] };
}

// execFileSync with an argument array — no shell string interpolation,
// so the URL can never be interpreted as shell syntax.
// `timeoutMs` is REQUIRED for any call that should count against the
// investigation deadline: execFileSync sends SIGTERM and throws if the
// child hasn't finished within that window, which is what actually makes
// MAX_INVESTIGATION_TIME_MS a hard ceiling instead of a comment.
function webcmd(args, timeoutMs) {
  try {
    const command = webcmdExecutable();
    return execFileSync(command.executable, [...command.prefixArgs, ...args], {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 20,
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (
      err.killed ||
      err.signal === "SIGTERM" ||
      err.code === "ETIMEDOUT"
    ) {
      throw new Error(
        `Investigation timed out after ${
          MAX_INVESTIGATION_TIME_MS / 1000
        }s (stuck during: webcmd ${args.slice(0, 2).join(" ")})`
      );
    }

    const stderr = typeof err.stderr === "string"
      ? err.stderr.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim()
      : "";
    const summary = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
    throw new Error(summary || `Webcmd failed while running ${args.slice(0, 2).join(" ")}`);
  }
}

function createSession(timeoutMs) {
  const out = JSON.parse(webcmd(["session", "create", "-f", "json"], timeoutMs));
  const sessionId = out.session || out.id || out.sessionId;
  if (!sessionId) throw new Error("Webcmd did not return a session ID");
  return sessionId;
}

function closeSession(sessionId) {
  try {
    // Fixed, generous-but-bounded budget: cleanup should never be skipped
    // just because the investigation's own budget ran out, but it also
    // shouldn't be allowed to hang forever.
    webcmd(["session", "close", sessionId], SESSION_CLOSE_TIMEOUT_MS);
  } catch (err) {
    // Don't let a failed cleanup mask the real error / crash the process.
    console.error("Warning: failed to close session cleanly:", err.message);
  }
}

function runPhase(sessionId, scriptRelPath, url, timeoutMs) {
  const scriptPath = path.join(
    __dirname,
    "..",
    scriptRelPath
  );

  const originalSource = fs.readFileSync(scriptPath, "utf8");

  const placeholder = '"__LEAKLENS_URL__"';
  if (!originalSource.includes(placeholder)) {
    throw new Error(`Browser script is missing its URL placeholder: ${scriptRelPath}`);
  }
  const patchedSource = originalSource.replaceAll(placeholder, JSON.stringify(url));

  const tempPath = path.join(
    os.tmpdir(),
    `leaklens-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.js`
  );

  fs.writeFileSync(tempPath, patchedSource, "utf8");

  try {
    const raw = webcmd(
      [
        "--session",
        sessionId,
        "browser",
        "run",
        "--file",
        tempPath,
        "--timeout",
        String(Math.max(1, Math.floor(timeoutMs / 1000))),
        "--max-output",
        "200000",
        "--no-snapshot-diff",
      ],
      timeoutMs
    );

    const parsed = JSON.parse(raw);
    return parsed.result ?? parsed;
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
  }
}

// --- DECIDE step: deterministic decision policy -----------------------
// Deliberately deterministic (not an LLM call) so the "why did the agent
// dig deeper" answer is always exact and reproducible for a demo/judge.
function decideIfDeeperInvestigationNeeded(phase1Evidence) {
  const reasons = [];

  const hasExternalForm = phase1Evidence.forms.items.some((f) => f.externalDestination);
  if (hasExternalForm) {
    reasons.push("A form submits to an external domain — worth confirming behavior under interaction.");
  }

  const domainCount = phase1Evidence.network.uniqueThirdPartyDomains;
  // Borderline near a scoring-tier boundary: worth a second look since
  // a few more (likely lazy-loaded) domains could shift the risk tier.
  if (domainCount >= 2 && domainCount <= 6) {
    reasons.push(`Third-party domain count (${domainCount}) is near a scoring tier boundary.`);
  }

  const hasSensitiveInput = phase1Evidence.forms.sensitiveFieldCount > 0;
  if (hasSensitiveInput && domainCount > 0) {
    reasons.push("Sensitive input fields present alongside third-party activity — combination worth verifying.");
  }

  const needed = reasons.length > 0;
  return {
    // Visible, demo-friendly decision label in addition to the raw fields.
    decision: needed ? "DEEP_INVESTIGATION" : "SUFFICIENT",
    needed,
    reason: needed ? reasons.join(" ") : "Phase 1 evidence sufficient; no deeper pass warranted.",
    reasons,
  };
}

function mergeEvidence(phase1, phase2) {
  if (!phase2) {
    return {
      ...phase1,
      network: { ...phase1.network, newlyDiscoveredOnDeeperInspection: [] },
    };
  }

  const mergedDomains = [...new Set([...phase1.network.domains, ...phase2.network.domains])];
  const newlyDiscovered = phase2.network.domains.filter((d) => !phase1.network.domains.includes(d));

  return {
    ...phase1,
    // forms/scripts are only extracted in phase 1 (DOM inspection); phase 2
    // is a network-focused re-observation of the same page after scrolling.
    network: {
      totalRequests: phase1.network.totalRequests + phase2.network.totalRequests,
      firstPartyRequests: phase1.network.firstPartyRequests + phase2.network.firstPartyRequests,
      thirdPartyRequests: phase1.network.thirdPartyRequests + phase2.network.thirdPartyRequests,
      uniqueThirdPartyDomains: mergedDomains.length,
      domains: mergedDomains,
      sampleThirdPartyRequests: [
        ...phase1.network.sampleThirdPartyRequests,
        ...phase2.network.sampleThirdPartyRequests,
      ].slice(0, 40),
      newlyDiscoveredOnDeeperInspection: newlyDiscovered,
    },
  };
}

// --- EXPLAIN step: Gemini narrates, never scores ----------------------
async function explainWithGemini(evidence, scoring, plannerDecision, remainingMs) {
  const prompt = `
You are a privacy analyst writing plain-language explanations for a
PRE-COMPUTED, deterministic risk score.

Hard rules — follow all of them:
1. You must NOT invent, adjust, or restate the risk score as your own judgment.
   The score is final and already computed; only explain it.
2. Only make claims that are directly supported by the provided evidence
   object. Do not speculate beyond it.
3. Clearly distinguish OBSERVED facts (e.g. "31 third-party network
   requests were observed") from INFERRED classifications (e.g. domain
   category guesses).
4. Do NOT describe any request or domain as a "data leak" unless the
   evidence explicitly demonstrates data was transmitted somewhere
   inappropriate (e.g. a sensitive field posting to an external form
   destination). Otherwise, describe it neutrally as "observed" activity.
5. Domain categorizations (Analytics/Advertising/Tracking/CDN) are
   heuristic pattern matches, not confirmed facts. Use hedged language
   such as "likely an analytics service" and mention it's based on
   domain-name pattern matching, not verified behavior.
6. Never modify, override, or second-guess the deterministic risk score
   or its breakdown.

Evidence (structured, from live browser observation):
${JSON.stringify(evidence, null, 2)}

Deterministic scoring (already computed, do not change):
${JSON.stringify(scoring, null, 2)}

Agent's investigation decision:
${JSON.stringify(plannerDecision, null, 2)}

Return ONLY JSON (no markdown, no prose) with this shape:
{
  "evidenceBullets": [ string ],   // short, factual, "observed" statements
  "reasoning": string,             // 2-4 sentences connecting evidence to the score
  "dataCollectionFindings": [ string ],
  "findings": [                    // 2-5 of the most notable findings, judge-facing
    {
      "title": string,             // e.g. "External form destination"
      "evidence": string,          // what was observed (fact only)
      "whyItMatters": string,      // plain-language impact, hedged appropriately
      "basis": "observed" | "inferred"
    }
  ]
}
`.trim();

  // Unlike execFileSync above, fetch() is genuinely async, so a plain
  // timer can actually preempt it — but it still needs to respect
  // whatever's left of the shared investigation deadline, not a fresh
  // timeout of its own.
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(remainingMs, GEMINI_TIMEOUT_MS))
  );
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=` +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                evidenceBullets: { type: "ARRAY", items: { type: "STRING" } },
                reasoning: { type: "STRING" },
                dataCollectionFindings: { type: "ARRAY", items: { type: "STRING" } },
                findings: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      evidence: { type: "STRING" },
                      whyItMatters: { type: "STRING" },
                      basis: { type: "STRING", enum: ["observed", "inferred"] },
                    },
                    required: ["title", "evidence", "whyItMatters", "basis"],
                  },
                },
              },
              required: ["evidenceBullets", "reasoning", "dataCollectionFindings", "findings"],
            },
          },
        }),
        signal: controller.signal,
      }
    );
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Gemini explanation timed out after ${Math.min(remainingMs, GEMINI_TIMEOUT_MS) / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini API returned HTTP ${res.status}: ${data.error?.message || "request failed"}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No response from Gemini: " + JSON.stringify(data));
  return JSON.parse(text);
}

async function runInvestigation(targetUrl) {
  assertValidUrl(targetUrl);
  console.log(`\n🔎 LeakLens investigating: ${targetUrl}\n`);

  // Single shared deadline for the whole investigation. Every step below
  // spends against it via requireTime(), which is what makes
  // MAX_INVESTIGATION_TIME_MS an enforced ceiling rather than aspirational.
  const deadline = Date.now() + MAX_INVESTIGATION_TIME_MS;
  function requireTime(step) {
    const r = deadline - Date.now();
    if (r <= 0) {
      throw new Error(`Investigation timed out after ${MAX_INVESTIGATION_TIME_MS / 1000}s (ran out of time before: ${step})`);
    }
    return r;
  }

  const sessionId = createSession(requireTime("session create"));
  let phase1, phase2 = null, plannerDecision;
  const phases = [];

  try {
    console.log("✓ [OBSERVE] Running phase 1 exploration...");
    phase1 = runPhase(sessionId, "webcmd/explore.js", targetUrl, requireTime("phase 1 exploration"));
    phases.push({ phase: "initial", actions: phase1.actions || ["navigate", "inspect_dom", "capture_network"] });
    console.log(
      `  ${phase1.network.totalRequests} requests, ${phase1.network.uniqueThirdPartyDomains} unique third-party domains, ${phase1.forms.count} form(s)`
    );

    console.log("● [DECIDE] Evaluating whether deeper investigation is warranted...");
    plannerDecision = decideIfDeeperInvestigationNeeded(phase1);

    if (plannerDecision.needed) {
      console.log(`  → ${plannerDecision.decision}: ${plannerDecision.reason}`);
      console.log("✓ [ACT] Running phase 2 interaction (scroll + extended wait, same page)...");
      phase2 = runPhase(sessionId, "webcmd/interact.js", targetUrl, requireTime("phase 2 interaction"));
      phases.push({ phase: "deep", actions: phase2.actions || ["scroll", "capture_network"] });
      const newCount = phase2.network.domains.filter((d) => !phase1.network.domains.includes(d)).length;
      console.log(`  Phase 2 found ${phase2.network.uniqueThirdPartyDomains} third-party domains (${newCount} new)`);
    } else {
      console.log(`  → ${plannerDecision.decision}: ${plannerDecision.reason}`);
    }
  } finally {
    closeSession(sessionId);
    console.log("✓ Session closed.\n");
  }

  const evidence = mergeEvidence(phase1, phase2);
  const scoring = scoreEvidence(evidence);

  console.log(`[SCORE] Deterministic risk score: ${scoring.score}/100 (${scoring.level})`);
  scoring.breakdown.forEach((b) => console.log(`   - ${b.component}: +${b.points} (${b.reason})`));

  console.log("\n[EXPLAIN] Asking Gemini to narrate the evidence (not the score)...\n");
  let explanation;
  try {
    explanation = await explainWithGemini(
      evidence,
      scoring,
      plannerDecision,
      requireTime("Gemini explanation")
    );
  } catch (err) {
    console.error(`Warning: Gemini explanation unavailable: ${err.message}`);
    explanation = {
      status: "unavailable",
      evidenceBullets: [],
      reasoning: "The deterministic investigation and score completed, but the optional Gemini explanation was unavailable.",
      dataCollectionFindings: [],
      findings: [],
    };
  }

  
  return {
    investigatedUrl: targetUrl,
    generatedAt: new Date().toISOString(),
    agentLoop: {
      phase1Summary: {
        requests: phase1.network.totalRequests,
        thirdPartyDomains: phase1.network.uniqueThirdPartyDomains,
      },
      plannerDecision,
      phase2Ran: !!phase2,
      phase2Summary: phase2
        ? {
            continuedExistingPage: phase2.continuedExistingPage === true,
            requestsObservedAfterInteraction: phase2.network.totalRequests,
            newlyDiscoveredThirdPartyDomains:
              evidence.network.newlyDiscoveredOnDeeperInspection,
          }
        : null,
      investigationPhases: phases, // "🤖 Agent performed N investigation phases."
    },
    evidence,
    scoring,
    explanation,
    // Pre-formatted, correctly-labeled strings for the frontend so wording
    // discipline (requests observed != trackers/leaks found) lives in one
    // place instead of being re-derived per UI. Prefer these over composing
    // labels from evidence.network.* directly.
    //   "143 total network requests"
    //   "31 third-party requests"
    //   "8 unique third-party domains"
    //   "143 requests observed across 2 investigation phases"
    displaySummary: {
      totalRequestsLabel: `${evidence.network.totalRequests} total network request${evidence.network.totalRequests === 1 ? "" : "s"}`,
      thirdPartyRequestsLabel: `${evidence.network.thirdPartyRequests} third-party requests`,
      uniqueThirdPartyDomainsLabel: `${evidence.network.uniqueThirdPartyDomains} unique third-party domains`,
      requestsAcrossPhasesLabel: `${evidence.network.totalRequests} network request${evidence.network.totalRequests === 1 ? "" : "s"} observed across ${phases.length} investigation phase${phases.length === 1 ? "" : "s"}`,
    },
    humanApprovalRequired: true,
  };
}

function investigate(targetUrl) {
  // Each synchronous Webcmd call has an execFileSync timeout derived from
  // the shared deadline, and Gemini has an AbortController timeout. Avoid a
  // Promise.race here: its losing timer keeps successful CLI runs alive and
  // cannot stop an already-running synchronous child process.
  return runInvestigation(targetUrl);
}

async function main() {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error("Usage: node agent/controller.js <url>");
    process.exit(1);
  }
  try {
    const report = await investigate(targetUrl);
    console.log("=== FINAL REPORT (pending human review before publishing) ===\n");
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    // Graceful failure — never crash with a raw stack trace on stage.
    console.error("❌ Investigation failed");
    console.error(`Reason: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { investigate };
