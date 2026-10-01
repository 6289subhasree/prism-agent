const { parse } = require("tldts");
const { isIP } = require("node:net");

function siteIdentity(value) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${isIP(value) === 6 ? `[${value}]` : value}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const parsed = parse(hostname, { allowPrivateDomains: true });
    // Unknown suffixes, IP addresses, and single-label hosts use exact matching.
    const domain = (parsed.isIcann || parsed.isPrivate) && parsed.domain ? parsed.domain : hostname;
    return { hostname, domain };
  } catch { return null; }
}

function isThirdParty(value, referenceUrl) {
  const reference = siteIdentity(referenceUrl), resource = siteIdentity(value);
  if (!reference) throw new Error("Cannot classify traffic without a valid reference URL");
  return resource ? resource.domain !== reference.domain : false;
}

function classifyNetwork(requestsByHostname, referenceUrl, samples = []) {
  const reference = siteIdentity(referenceUrl);
  if (!reference) throw new Error("Cannot classify traffic without a valid reference URL");
  if (!Array.isArray(requestsByHostname)) throw new Error("Browser evidence is missing per-host request counts");
  const counts = new Map();
  for (const entry of requestsByHostname) {
    const site = siteIdentity(entry.hostname);
    if (!site || !Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error("Invalid per-host request count");
    if (entry.count) counts.set(site.hostname, (counts.get(site.hostname) || 0) + entry.count);
  }
  const hosts = [...counts].map(([hostname, count]) => ({ hostname, count, thirdParty: isThirdParty(hostname, referenceUrl) }));
  const external = hosts.filter(host => host.thirdParty);
  const totalRequests = hosts.reduce((sum, host) => sum + host.count, 0);
  const thirdPartyRequests = external.reduce((sum, host) => sum + host.count, 0);
  return {
    totalRequests, firstPartyRequests: totalRequests - thirdPartyRequests, thirdPartyRequests,
    uniqueThirdPartyDomains: external.length, domains: external.map(host => host.hostname),
    requestsByHostname: hosts,
    sampleThirdPartyRequests: samples.filter(sample => isThirdParty(sample.url, referenceUrl))
      .slice(0, 40).map(sample => ({ ...sample, domain: siteIdentity(sample.url).hostname, thirdParty: true })),
    classification: {
      method: "registrable-domain", version: 1, privateSuffixes: true,
      referenceUrl, referenceHostname: reference.hostname, referenceDomain: reference.domain,
    },
  };
}

function classifyEvidence(phase, referenceUrl = phase.finalUrl) {
  const result = { ...phase, network: classifyNetwork(phase.network.requestsByHostname, referenceUrl, phase.network.requestSamples) };
  if (phase.forms) {
    const items = phase.forms.items.map(form => ({
      ...form, externalDestination: form.actionKind === "http" && isThirdParty(form.resolvedAction, referenceUrl),
    }));
    result.forms = { ...phase.forms, items, externalActionCount: items.filter(form => form.externalDestination).length };
  }
  if (phase.scripts) {
    const sources = phase.scripts.sources.filter(source => isThirdParty(source, referenceUrl));
    const domains = [...new Set(sources.map(source => siteIdentity(source).hostname))];
    result.scripts = { externalCount: sources.length, uniqueExternalDomains: domains.length, domains };
  }
  return result;
}

function classifyConsentResult(result) {
  if (result.status !== "observed") return result;
  const before = classifyNetwork(result.beforeRequestsByHostname, result.finalUrl);
  const after = classifyNetwork(result.afterRequestsByHostname, result.finalUrl);
  return {
    ...result, beforeDomains: before.domains, afterDomains: after.domains,
    afterRequests: after.thirdPartyRequests, classification: after.classification,
    beforeRequestsByHostname: before.requestsByHostname, afterRequestsByHostname: after.requestsByHostname,
  };
}

module.exports = { siteIdentity, isThirdParty, classifyNetwork, classifyEvidence, classifyConsentResult };
