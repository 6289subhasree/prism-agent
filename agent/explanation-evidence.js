// Keep aggregate evidence intact while bounding detail sent to the explanation
// provider. Request URLs, query strings, hidden field names and raw HTML are
// unnecessary for explaining the deterministic rubric.
function explanationEvidence(evidence) {
  const network = evidence.network || {}, forms = evidence.forms || {}, scripts = evidence.scripts || {};
  const items = forms.items || [];
  return {
    network: {
      totalRequests: network.totalRequests, firstPartyRequests: network.firstPartyRequests,
      thirdPartyRequests: network.thirdPartyRequests, uniqueThirdPartyDomains: network.uniqueThirdPartyDomains,
      domains: (network.domains || []).slice(0, 40), classification: network.classification,
    },
    forms: {
      count: forms.count, sensitiveFieldCount: forms.sensitiveFieldCount, externalActionCount: forms.externalActionCount,
      items: items.slice(0, 20).map(form => ({
        actionKind: form.actionKind, externalDestination: form.externalDestination,
        inputTypes: [...new Set((form.inputs || []).map(input => input.type))],
      })),
    },
    scripts: { externalCount: scripts.externalCount, domains: (scripts.domains || []).slice(0, 40) },
    omittedDetails: {
      networkDomains: Math.max(0, (network.domains || []).length - 40),
      forms: Math.max(0, items.length - 20), scriptDomains: Math.max(0, (scripts.domains || []).length - 40),
      requestSamplesExcluded: true,
    },
  };
}
module.exports = { explanationEvidence };
