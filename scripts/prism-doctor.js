#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const DOCTOR_TIMEOUT_MS = 20_000;
const VERSION_TIMEOUT_MS = 5_000;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message, action) {
  console.error(`FAIL: ${message}`);
  console.error(`Action: ${action}`);
  process.exitCode = 1;
}

function safeEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      const upper = name.toUpperCase();
      return upper !== "GEMINI_API_KEY" &&
        !/(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)(?:_|$)/.test(upper);
    })
  );
}

function runWebcmd(entry, args, timeout) {
  return spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    env: safeEnvironment(),
    timeout,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseDoctorJson(output) {
  const text = String(output || "").trim();
  try {
    return JSON.parse(text);
  } catch {}

  const starts = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{" && (index === 0 || text[index - 1] === "\n" || text[index - 1] === "\r")) {
      starts.push(index);
    }
  }
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(text.slice(starts[index]));
    } catch {}
  }
  return null;
}

function resultFailure(result) {
  if (result.error?.code === "ETIMEDOUT" || result.signal) return "timed out";
  if (result.error) return `could not start (${result.error.code || result.error.message})`;
  if (result.status !== 0) return `exited with code ${result.status}`;
  return null;
}

function main() {
  pass(`Node ${process.version}`);

  let webcmdEntry;
  try {
    webcmdEntry = require.resolve("@agentrhq/webcmd");
    pass(`Project-local Webcmd found at ${webcmdEntry}`);
  } catch {
    fail(
      "Project-local Webcmd is missing.",
      "Run `npm install`, then run `npm run prism:doctor` again."
    );
    return;
  }

  const versionResult = runWebcmd(webcmdEntry, ["--version"], VERSION_TIMEOUT_MS);
  const versionFailure = resultFailure(versionResult);
  if (versionFailure) {
    fail(
      `Webcmd --version ${versionFailure}.`,
      "Reinstall dependencies with `npm install` and verify that your Node version satisfies Webcmd's requirements."
    );
    return;
  }

  const version = versionResult.stdout.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) {
    fail(
      "Webcmd --version returned an unexpected response.",
      "Reinstall the project-local Webcmd package with `npm install`."
    );
    return;
  }
  pass(`Webcmd ${version}`);

  const doctorResult = runWebcmd(webcmdEntry, ["doctor", "--json"], DOCTOR_TIMEOUT_MS);
  const doctorFailure = resultFailure(doctorResult);
  if (doctorFailure) {
    const reason = doctorFailure === "timed out"
      ? `hung for more than ${DOCTOR_TIMEOUT_MS / 1000} seconds`
      : doctorFailure;
    fail(
      `Webcmd doctor ${reason}.`,
      "Close stale browser processes, then run `npm run prism:doctor` again. If it still fails, run the project-local Webcmd doctor with `--verbose`."
    );
    return;
  }

  const health = parseDoctorJson(doctorResult.stdout);
  if (!health) {
    fail(
      "Webcmd doctor returned unreadable health output.",
      "Run the project-local Webcmd doctor with `--verbose` and inspect its browser-bridge diagnostics."
    );
    return;
  }

  if (health.binary?.installed !== true || health.connectivity?.ok !== true) {
    const issues = Array.isArray(health.issues) ? health.issues.filter(Boolean) : [];
    const explanation = issues.join(" ") || health.connectivity?.error || "The browser runtime is unavailable.";
    fail(
      `Webcmd doctor reported an unhealthy browser bridge. ${explanation}`,
      "Install or repair the browser runtime, close stale Webcmd/browser processes, and rerun `npm run prism:doctor`."
    );
    return;
  }

  pass("Webcmd doctor reports a healthy browser bridge.");
  pass("PRISM Webcmd preflight completed successfully.");
}

main();
