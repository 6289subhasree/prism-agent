// evidence/scorer.js
// Deterministic, explainable scoring. Gemini never invents this number —
// it only explains it. Every point added here has a one-line reason
// attached, so "why is this 78 and not 62" has an exact answer.

const SENSITIVE_INPUT_TYPES = {
  email: 5,
  tel: 5,
  password: 15,
  text: 0, // generic text fields alone aren't inherently sensitive
};

// Heuristic domain categorization. A domain name alone doesn't prove what
// a service actually does with data, so categories are labeled "Likely …"
// and carry a confidence tag — never presented as a confirmed fact.
const KNOWN_CATEGORY_HINTS = [
  { pattern: /google-analytics|googletagmanager|gtag|analytics/i, category: "Likely Analytics", confidence: "medium" },
  { pattern: /doubleclick|adservice|ads\.|advertising|adsystem/i, category: "Likely Advertising", confidence: "medium" },
  { pattern: /facebook\.net|connect\.facebook|pixel/i, category: "Likely Tracking", confidence: "medium" },
  { pattern: /cdn\.|cloudfront|akamai|jsdelivr|unpkg/i, category: "CDN", confidence: "high" },
];

function categorize(domain) {
  const hit = KNOWN_CATEGORY_HINTS.find((h) => h.pattern.test(domain));
  return hit ? { category: hit.category, confidence: hit.confidence } : { category: "Other", confidence: "low" };
}

function scoreThirdPartyDomains(count) {
  if (count >= 10) return { points: 35, reason: `${count} unique third-party domains observed (10+ tier)` };
  if (count >= 6) return { points: 25, reason: `${count} unique third-party domains observed (6-10 tier)` };
  if (count >= 3) return { points: 15, reason: `${count} unique third-party domains observed (3-5 tier)` };
  if (count >= 1) return { points: 5, reason: `${count} unique third-party domain(s) observed (1-2 tier)` };
  return { points: 0, reason: "No third-party domains observed" };
}

function scoreExternalForms(forms) {
  const externalForms = forms.filter((f) => f.externalDestination);
  if (externalForms.length > 0) {
    return {
      points: 20,
      reason: `${externalForms.length} form(s) submit to an external domain`,
      externalForms,
    };
  }
  return { points: 0, reason: "No forms submit to an external domain", externalForms: [] };
}

function scoreSensitiveInputs(forms) {
  let points = 0;
  const findings = [];
  for (const form of forms) {
    for (const input of form.inputs) {
      const add = SENSITIVE_INPUT_TYPES[input.type] ?? 0;
      if (add > 0) {
        points += add;
        findings.push(`${input.type} field detected (+${add})`);
      }
    }
  }
  // Cap so a form with 10 email fields doesn't dominate the score
  points = Math.min(points, 30);
  return { points, reason: findings.length ? findings.join(", ") : "No sensitive input types detected", findings };
}

// Renamed from "trackers" to "tracking indicators" — we're matching domain
// name patterns, not confirming that a service actually tracks users.
function scoreTrackingIndicators(thirdPartyDomains) {
  const trackingIndicatorDomains = thirdPartyDomains
    .map((d) => ({ domain: d, ...categorize(d) }))
    .filter((d) => d.category === "Likely Analytics" || d.category === "Likely Advertising" || d.category === "Likely Tracking");

  const count = trackingIndicatorDomains.length;
  let points = 0;
  if (count >= 3) points = 20;
  else if (count >= 1) points = 10;

  return {
    points,
    reason:
      count > 0
        ? `${count} domain(s) heuristically match tracking/analytics/advertising patterns`
        : "No known tracking-indicator patterns matched",
    trackingIndicatorDomains,
  };
}

function riskLevel(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

// Accepts evidence in the structured { network, forms } shape produced by
// explore.js / interact.js / controller.js's mergeEvidence().
function scoreEvidence(evidence) {
  const thirdPartyDomains = evidence.network.domains;
  const forms = evidence.forms.items;

  const domainScore = scoreThirdPartyDomains(thirdPartyDomains.length);
  const formDestScore = scoreExternalForms(forms);
  const inputScore = scoreSensitiveInputs(forms);
  const trackingScore = scoreTrackingIndicators(thirdPartyDomains);

  const totalRaw = domainScore.points + formDestScore.points + inputScore.points + trackingScore.points;
  const total = Math.min(totalRaw, 100);

  const breakdown = [
    { component: "Third-party domain count", ...domainScore },
    { component: "External form destinations", ...formDestScore },
    { component: "Sensitive input fields", ...inputScore },
    { component: "Tracking indicators", ...trackingScore },
  ];

  return {
    score: total,
    riskScore: total, // alias — some consumers/UI expect `riskScore`
    level: riskLevel(total),
    breakdown,
    // Simple component -> points map, handy for a compact UI summary
    // (e.g. "Third-party activity +25, External form +20, ...").
    breakdownSummary: {
      thirdPartyActivity: domainScore.points,
      externalForm: formDestScore.points,
      sensitiveInputs: inputScore.points,
      trackingIndicators: trackingScore.points,
    },
    trackingIndicatorDomains: trackingScore.trackingIndicatorDomains,
  };
}

module.exports = { scoreEvidence, categorize };
