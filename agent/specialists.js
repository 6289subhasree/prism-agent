const { z } = require("zod");
const { isDeepStrictEqual } = require("node:util");

const findingSchema = z.object({
  id: z.string(),
  specialist: z.enum(["network", "consent"]),
  claim: z.enum(["network-summary", "consent-controls", "consent-request-difference"]),
  basis: z.enum(["observed", "inferred"]),
  values: z.record(z.string(), z.number().int().safe()),
  evidenceRefs: z.array(z.string()).min(1),
}).strict();
const count = value => Number.isSafeInteger(value) && value >= 0;
const finding = (specialist, claim, basis, values, evidenceRefs) => ({
  id: claim, specialist, claim, basis, values, evidenceRefs,
});

// Specialists propose structured claims, never unchecked prose or new scores.
function analyzeNetwork(report) {
  const network = report.evidence?.network;
  if (!network || ![network.totalRequests, network.thirdPartyRequests, network.uniqueThirdPartyDomains].every(count)) {
    return { findings: [], warnings: ["Network request counts are unavailable; no network finding was produced."] };
  }
  return { findings: [finding("network", "network-summary", "observed", {
    totalRequests: network.totalRequests,
    thirdPartyRequests: network.thirdPartyRequests,
    thirdPartyHostnames: network.uniqueThirdPartyDomains,
  }, ["/evidence/network"])], warnings: [] };
}

function analyzeConsent(report) {
  const findings = [], warnings = [];
  const consent = report.consent;
  if (consent?.status === "detected" && Array.isArray(consent.controls)) {
    findings.push(finding("consent", "consent-controls", "inferred", {
      accept: consent.controls.filter(control => control.inferredAction === "accept").length,
      reject: consent.controls.filter(control => control.inferredAction === "reject").length,
    }, ["/consent/status", "/consent/controls"]));
  } else if (consent?.status === "unavailable") {
    warnings.push("Consent controls could not be inspected; absence of controls is not established.");
  }
  const comparison = report.consentComparison;
  if (comparison?.comparison && Number.isSafeInteger(comparison.comparison.requestDifference)) {
    findings.push(finding("consent", "consent-request-difference", "observed", {
      difference: comparison.comparison.requestDifference,
    }, ["/consentComparison/runs", "/consentComparison/comparison/requestDifference"]));
  }
  return { findings, warnings };
}

// Only own properties can be cited; prototype paths are never evidence.
function resolveEvidence(report, pointer) {
  if (!pointer.startsWith("/")) throw new Error("Evidence reference must be a JSON pointer");
  return pointer.slice(1).split("/").reduce((value, token) => {
    if (/~(?![01])/u.test(token)) throw new Error("Invalid JSON pointer escape");
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (["__proto__", "prototype", "constructor"].includes(key) || value == null || !Object.hasOwn(value, key)) {
      throw new Error(`Missing evidence: ${pointer}`);
    }
    return value[key];
  }, report);
}

function verifyClaim(report, candidate) {
  const claim = findingSchema.parse(candidate);
  claim.evidenceRefs.forEach(ref => resolveEvidence(report, ref));
  let expected, text;
  if (claim.claim === "network-summary") {
    const network = report.evidence?.network;
    const rows = network?.requestsByHostname;
    if (!Array.isArray(rows) || rows.some(row => typeof row.hostname !== "string" || !row.hostname || !count(row.count) || typeof row.thirdParty !== "boolean")) {
      throw new Error("Per-hostname request evidence is unavailable or invalid");
    }
    if (new Set(rows.map(row => row.hostname)).size !== rows.length) throw new Error("Duplicate hostname evidence");
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const external = rows.filter(row => row.thirdParty);
    const thirdParty = external.reduce((sum, row) => sum + row.count, 0);
    if (!count(total) || !count(thirdParty) || total !== network.totalRequests || thirdParty !== network.thirdPartyRequests || external.length !== network.uniqueThirdPartyDomains) {
      throw new Error("Network totals disagree with per-hostname evidence");
    }
    expected = finding("network", "network-summary", "observed", {
      totalRequests: total, thirdPartyRequests: thirdParty, thirdPartyHostnames: external.length,
    }, ["/evidence/network"]);
    text = `${thirdParty} of ${total} captured requests went to ${external.length} third-party hostnames. Third-party classification does not by itself establish tracking.`;
  } else if (claim.claim === "consent-controls") {
    const consent = report.consent;
    if (consent?.status !== "detected" || !Array.isArray(consent.controls)) throw new Error("No detected consent controls to support this claim");
    const accept = consent.controls.filter(control => control.inferredAction === "accept").length;
    const reject = consent.controls.filter(control => control.inferredAction === "reject").length;
    expected = finding("consent", "consent-controls", "inferred", { accept, reject }, ["/consent/status", "/consent/controls"]);
    text = `Labels suggest ${accept} accept and ${reject} reject controls. This label-based interpretation does not establish what clicking them does.`;
  } else {
    const comparison = report.consentComparison;
    const runs = comparison?.runs;
    if (comparison?.status !== "completed" || !Array.isArray(runs) || runs.length !== 2 ||
        runs.some(run => run.status !== "observed" || run.controlDismissed !== true || run.observationMs !== 3000 || !count(run.afterRequests))) {
      throw new Error("Two completed, dismissed, three-second consent observations are required");
    }
    const accept = runs.find(run => run.choice === "accept");
    const reject = runs.find(run => run.choice === "reject");
    if (!accept || !reject) throw new Error("Both consent choices are required");
    const difference = accept.afterRequests - reject.afterRequests;
    if (comparison.comparison?.requestDifference !== difference) throw new Error("Consent difference disagrees with observed counts");
    expected = finding("consent", "consent-request-difference", "observed", { difference }, ["/consentComparison/runs", "/consentComparison/comparison/requestDifference"]);
    text = `The accept run recorded ${difference > 0 ? "+" : ""}${difference} third-party requests compared with reject over three seconds per run. These separate observations do not establish causation or compliance.`;
  }
  if (!isDeepStrictEqual(claim, expected)) throw new Error("Claim values, source, basis, or references do not match the evidence rule");
  return { ...claim, text, verification: "evidence-consistent" };
}

function verifyFindings(report, candidates) {
  const findings = [], rejected = [], seen = new Set();
  for (const candidate of candidates) {
    try {
      const verified = verifyClaim(report, candidate);
      if (seen.has(verified.id)) throw new Error("Duplicate finding");
      seen.add(verified.id);
      findings.push(verified);
    } catch (error) {
      rejected.push({ id: typeof candidate?.id === "string" ? candidate.id : "invalid-finding", reason: error.message });
    }
  }
  return {
    schemaVersion: "prism.findings.v1", status: rejected.length ? "partial" : "completed",
    findings, rejected,
    scope: "Checks structured specialist claims against captured report evidence. Does not verify Gemini prose, capture completeness, or legal compliance.",
  };
}

module.exports = { analyzeNetwork, analyzeConsent, verifyFindings, resolveEvidence };
