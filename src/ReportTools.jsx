export function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const host = new URL(report.investigatedUrl).hostname.replace(/[^a-z0-9.-]/gi, "_");
  link.href = url;
  link.download = `prism-${host}-${(report.generatedAt || "report").replace(/[^a-z0-9-]/gi, "_")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DomainList({ label, domains = [] }) {
  const sorted = [...new Set(domains)].sort();
  return <details className="comparison-domains">
    <summary>{label} <span>({sorted.length})</span></summary>
    {sorted.length ? <ul>{sorted.map(domain => <li key={domain}>{domain}</li>)}</ul> : <p>No domains observed in this group.</p>}
  </details>;
}

export function ConsentComparison({ result }) {
  if (!result || result.status === "disabled") return null;
  const comparison = result.comparison;
  return <section className="proof consent-proof">
    <div><div className="eyebrow">CONSENT COMPARISON</div><h3>AFTER THE CHOICE.</h3>
      <p>Accept and reject were attempted in separate fresh profiles. Traffic is observed for three seconds after each click.</p>
      <p>Differences between sequential runs do not prove causation or compliance.</p>
    </div>
    <div className="comparison-results">
      {result.runs.map(run => <article className="comparison-run" key={run.choice}>
        <header><h4>{run.choice.toUpperCase()}</h4><span>{run.status}</span></header>
        {run.status === "observed" ? <>
          <p className="comparison-count"><strong>{run.afterRequests}</strong> third-party requests · {run.afterDomains.length} domains</p>
          <p className="comparison-note">Clicked: {run.clickedLabel || "Label unavailable"}{!run.controlDismissed && " · Control remained visible; comparison withheld."}</p>
          <DomainList label={`Domains after ${run.choice}`} domains={run.afterDomains} />
        </> : <p>{run.reason || "No observation available for this run."}</p>}
        {run.warnings?.map((warning, i) => <p className="comparison-note" key={i}>{typeof warning === "string" ? warning : JSON.stringify(warning)}</p>)}
      </article>)}
      {comparison ? <div className="comparison-difference">
        <p><strong>{comparison.requestDifference > 0 ? "+" : ""}{comparison.requestDifference}</strong> requests after accept compared with reject</p>
        <DomainList label="Domains only in the accept run" domains={comparison.acceptOnlyDomains} />
        <DomainList label="Domains only in the reject run" domains={comparison.rejectOnlyDomains} />
      </div> : <p>Comparison unavailable: both choices need a completed observation and a dismissed control. Available results are shown above.</p>}
      {result.limitations?.length > 0 && <details className="comparison-domains"><summary>How to read these results</summary><ul>{result.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>}
    </div>
  </section>;
}
