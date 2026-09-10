const { z } = require('zod');
const snapshotSchema = z.object({
  observedAt: z.string().datetime(),
  pageUrl: z.string().url(),
  bannerCount: z.number().int().min(0).max(5),
  controls: z.array(z.object({ bannerIndex: z.number().int().min(0).max(4), label: z.string().min(1).max(160) })).max(50),
  scope: z.literal('top-level-document'),
});

function analyzeConsent(snapshot) {
  const evidence = snapshotSchema.parse(snapshot);
  const classify = (label) => {
    if (/^(reject|decline|deny)( all)?( cookies)?[.!]?$/i.test(label) || /^(only necessary|necessary only|use necessary cookies only)[.!]?$/i.test(label)) return 'reject';
    if (/^(accept|allow)( all)?( cookies)?[.!]?$/i.test(label)) return 'accept';
    if (/^(manage|customi[sz]e|cookie|consent|privacy)( cookie| consent)? (settings|preferences|options)[.!]?$/i.test(label) || /^customi[sz]e$/i.test(label)) return 'settings';
    return 'unknown';
  };
  return {
    ...evidence,
    status: evidence.bannerCount ? 'detected' : 'not-observed',
    controls: evidence.controls.map(control => ({ ...control, inferredAction: classify(control.label) })),
    limitations: ['English labels only; control actions are inferred from text.', 'Iframes and shadow DOM are not inspected. Absence of an observed banner does not establish absence of consent controls.'],
  };
}
module.exports = { analyzeConsent };
