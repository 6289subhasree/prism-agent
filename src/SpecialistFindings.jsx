import { evidenceAt } from "./finding-evidence.mjs";

export function SpecialistFindings({ report }) {
  const result = report.specialistFindings;
  if (!result) return null;
  return <section className="specialist-findings" aria-labelledby="specialist-title">
    <div className="eyebrow">RULE-BASED SPECIALISTS</div>
    <h3 id="specialist-title">Findings with evidence</h3>
    <p className="specialist-scope">These checks match structured claims to captured evidence. They do not verify Gemini’s explanation or establish compliance.</p>
    {result.error && <p role="status">Finding verification unavailable: {result.error}</p>}
    {result.warnings?.map((warning, index) => <p className="specialist-warning" key={index}>{warning}</p>)}
    {result.findings.map(finding => <article className="specialist-finding" key={finding.id}>
      <header><strong>{finding.specialist === "network" ? "Network" : "Consent"}</strong><span>{finding.basis} · evidence-consistent</span></header>
      <p>{finding.text}</p>
      <details>
        <summary>Inspect supporting evidence ({finding.evidenceRefs.length})</summary>
        {finding.evidenceRefs.map(ref => <div className="finding-evidence" key={ref}>
          <code>{ref}</code>
          <pre>{JSON.stringify(evidenceAt(report, ref), null, 2) ?? "Evidence unavailable"}</pre>
        </div>)}
      </details>
    </article>)}
    {!result.findings.length && !result.error && <p>No specialist findings passed the evidence checks for this run.</p>}
    {result.rejected?.length > 0 && <details className="specialist-withheld">
      <summary>{result.rejected.length} finding{result.rejected.length === 1 ? "" : "s"} withheld</summary>
      <ul>{result.rejected.map((finding, index) => <li key={index}><code>{finding.id}</code>: {finding.reason}</li>)}</ul>
    </details>}
  </section>;
}
