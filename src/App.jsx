import { useCallback, useEffect, useRef, useState } from "react";
import { ConsentComparison, downloadReport } from "./ReportTools.jsx";
import prismHero from "./assets/prism-hero.jpg";

const STEPS = ["OBSERVE", "DECIDE", "ACT", "OBSERVE", "SCORE", "EXPLAIN"];
const DEMO_DOMAINS = ["googletagmanager.com", "cdn.segment.com", "doubleclick.net", "assets.website.net"];

function useScrollProgress() {
  const captureScene = Number(new URLSearchParams(window.location.search).get("scene"));
  const [progress, setProgress] = useState(captureScene > 0 ? captureScene : 0);
  useEffect(() => {
    let raf = 0;
    const update = () => { raf = 0; setProgress(window.scrollY / Math.max(1, window.innerHeight)); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); window.addEventListener("scroll", onScroll, { passive: true });
    if (captureScene > 0) {
      document.body.dataset.captureScene = String(captureScene);
      setProgress(captureScene);
    }
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return progress;
}

function NetworkWorld({ progress }) {
  const p = Math.max(0, Math.min(4.6, progress));
  return <div className="world" aria-hidden="true" style={{ "--story": p }}>
    <div className="atmosphere" />
    <figure className="hero-photo"><img src={prismHero} alt="Laptop workspace overlooking an illuminated city at night" /></figure>
    <div className="browser-stack">
      <div className="layer network-layer"><span>NETWORK</span><i /><i /><i /><i /></div>
      <div className="layer script-layer"><span>SCRIPTS</span><code>async src=/tag.js</code><code>POST /collect</code></div>
      <div className="layer dom-layer"><span>DOM / FORMS</span><b /><b /><b /></div>
    </div>
    <svg className="traces" viewBox="0 0 1440 900" preserveAspectRatio="none">
      <defs><linearGradient id="spectral"><stop stopColor="#ece9e1"/><stop offset=".55" stopColor="#69d9ca"/><stop offset=".78" stopColor="#cc87ff"/><stop offset="1" stopColor="#ffb55e"/></linearGradient></defs>
      <path d="M735 450 C900 420 910 190 1190 170"/><path d="M730 470 C930 480 1010 350 1260 390"/><path d="M720 490 C900 570 990 670 1220 720"/><path d="M690 430 C510 330 390 290 150 330"/>
      <path className="refracted" d="M720 455 L890 455 L1220 230"/><path className="refracted two" d="M890 455 L1240 470"/><path className="refracted three" d="M890 455 L1190 700"/>
    </svg>
    <div className="refractive-plane"><span>PRISM</span></div>
    <div className="endpoint e1">{DEMO_DOMAINS[0]} <b>SCRIPT</b></div><div className="endpoint e2">{DEMO_DOMAINS[1]} <b>GET</b></div>
    <div className="endpoint e3">{DEMO_DOMAINS[2]} <b>PIXEL</b></div><div className="endpoint e4">{DEMO_DOMAINS[3]} <b>204</b></div>
    <div className="legend"><span>FIRST PARTY</span><span>ANALYTICS</span><span>ADVERTISING</span><span>UNKNOWN</span></div>
  </div>;
}

function Intro({ onDone }) {
  const tokens = ["REQUEST", "SCRIPT", "POST", "COOKIE", "THIRD PARTY", "UNKNOWN"];
  const capture = new URLSearchParams(window.location.search).get("captureIntro") === "1";
  useEffect(() => { if (capture) return undefined; const timer = setTimeout(onDone, 2350); return () => clearTimeout(timer); }, [capture, onDone]);
  return <div className={`intro ${capture ? "intro-capture" : ""}`} aria-hidden="true">
    <div className="intro-noise">{tokens.map((token, i) => <span key={token} style={{"--i":i}}>{token}</span>)}</div>
    <div className="intro-word">PRISM<i/></div>
    <div className="intro-wipe"/>
  </div>;
}

function UrlForm({ value, onChange, onSubmit, compact = false, disabled = false }) {
  return <form className={`url-form ${compact ? "compact" : ""}`} onSubmit={onSubmit}>
    <label><span>ENTER A PUBLIC WEBSITE TO INVESTIGATE</span>
      <div><input aria-label="Website URL" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="https://example.com" inputMode="url" autoComplete="url"/><button disabled={disabled} aria-label="Investigate">{disabled ? "RUNNING" : "INVESTIGATE"}<i>↗</i></button></div>
    </label>
  </form>;
}

function AgentMap() {
  return <div className="agent-map">
    <div className="map-main">{STEPS.map((s, i) => <div className={s === "ACT" ? "conditional" : ""} key={i}><small>0{i + 1}</small><strong>{s}</strong>{s === "ACT" && <em>IF REQUIRED</em>}</div>)}</div>
    <div className="branch"><span>SUFFICIENT</span><i /> <span>DEEP INVESTIGATION</span></div>
  </div>;
}

function Investigation({ url, setUrl, status, phases, error, onSubmit }) {
  const active = phases.at(-1)?.id;
  return <section className="investigate" id="investigate">
    <div className="section-index">06 / INVESTIGATE</div>
    <div className="investigate-head"><h2>Follow the actual trail.</h2><p>Evidence appears only after PRISM observes it in a real browser session.</p></div>
    <UrlForm value={url} onChange={setUrl} onSubmit={onSubmit} compact disabled={status === "running"}/>
    {(status === "running" || error) && <div className="live-panel" aria-live="polite">
      <div className="live-top"><span><i className="live-dot"/> LIVE INVESTIGATION</span><small>{url}</small></div>
      <div className="phase-rail">{STEPS.map((step, i) => {
        const candidates = phases.filter(p => p.label === step);
        const done = candidates.length > (step === "OBSERVE" && i === 3 ? 1 : 0);
        const isActive = phases.at(-1)?.label === step && (step !== "OBSERVE" || active === (i === 0 ? "observe-1" : "observe-2"));
        return <div key={i} className={`${done ? "done" : ""} ${isActive ? "active" : ""} ${step === "ACT" ? "maybe" : ""}`}><small>0{i+1}</small><strong>{step}</strong></div>;
      })}</div>
      <p className="phase-detail">{error || phases.at(-1)?.detail || "Opening an isolated browser session…"}</p>
      <small className="truth-label">LIVE STATUS — findings are not displayed until observed</small>
    </div>}
  </section>;
}

const metric = (label, value) => <div className="metric"><span>{label}</span><strong>{value}</strong></div>;

function Report({ report, onReset }) {
  const { evidence, scoring, agentLoop, explanation } = report;
  const inferred = scoring.trackingIndicatorDomains || [];
  return <main className="report" id="report">
    <header className="report-nav"><a href="#top" className="brand">PRISM<i/></a><div className="report-actions"><button onClick={() => downloadReport(report)}>DOWNLOAD JSON ↓</button><button onClick={onReset}>NEW INVESTIGATION ↗</button></div></header>
    <section className="verdict">
      <div className="report-kicker">DETERMINISTIC EVIDENCE REPORT <span>·</span> {new URL(report.investigatedUrl).hostname}</div>
      <div className="score"><strong>{scoring.score}</strong><span>/100</span></div>
      <div className={`risk risk-${scoring.level.toLowerCase()}`}><i/> {scoring.level} EXPOSURE</div>
      <p>This score is calculated from observed browser evidence—not generated by an LLM.</p>
    </section>
    <section className="evidence-grid">
      <div className="metrics">{metric("TOTAL REQUESTS", evidence.network.totalRequests)}{metric("THIRD PARTY", evidence.network.thirdPartyRequests)}{metric("UNIQUE EXTERNAL DOMAINS", evidence.network.uniqueThirdPartyDomains)}{metric("SENSITIVE FIELDS", evidence.forms.sensitiveFieldCount)}</div>
      <div className="breakdown"><div className="eyebrow">WHY {scoring.score}?</div>{scoring.breakdown.map(row => <div className="break-row" key={row.component}><strong>+{row.points}</strong><span>{row.component}<small>{row.reason}</small></span></div>)}</div>
    </section>
    <section className="proof">
      <div><div className="eyebrow">OBSERVED</div><h3>WHAT THE BROWSER SAW.</h3><p>Directly captured during {agentLoop.investigationPhases.length} investigation phase{agentLoop.investigationPhases.length > 1 ? "s" : ""}.</p></div>
      <div className="domain-list">{evidence.network.domains.length ? evidence.network.domains.map((d, i) => <div key={d}><small>{String(i+1).padStart(2,"0")}</small><span>{d}</span><em>THIRD PARTY</em></div>) : <p>No third-party domains were observed.</p>}</div>
    </section>
    <section className="proof inference">
      <div><div className="eyebrow">INFERRED / HEURISTIC</div><h3>PATTERNS,<br/>NOT VERDICTS.</h3><p>Hostname classifications are pattern matches. They do not prove tracking or a privacy violation.</p></div>
      <div className="domain-list">{inferred.length ? inferred.map(x => <div key={x.domain}><span>{x.domain}</span><em>{x.category} · {x.confidence} confidence</em></div>) : <p>No known tracking-indicator patterns matched.</p>}</div>
    </section>
    {report.consent && <section className="proof consent-proof">
      <div><div className="eyebrow">CONSENT CONTROLS</div><h3>COOKIE CHOICES.</h3><p>{report.consent.status === "unavailable" ? "Consent inspection was unavailable for this run." : report.consent.status === "detected" ? "These controls were observed. No consent choice was clicked." : "No consent banner was observed in the inspected document."}</p><p>English labels only. Iframes and shadow DOM are not inspected. Actions are inferred from labels; banner absence is not a compliance verdict.</p></div>
      <div className="domain-list">{report.consent.status === "unavailable" && <p role="status">Reason: {report.consent.error || "No error detail was returned."}</p>}{report.consent.controls?.map((control, i) => <div key={i}><span>{control.label}</span><em>{control.inferredAction.toUpperCase()} · INFERRED</em></div>)}</div>
    </section>}
    <ConsentComparison result={report.consentComparison} />
    <section className="loop-result"><div className="eyebrow">AGENT DECISION</div><h3>OBSERVE → DECIDE → {agentLoop.phase2Ran ? "ACT → OBSERVE → " : "SUFFICIENT → "}SCORE</h3><p>{agentLoop.plannerDecision.reason}</p>{agentLoop.phase2Ran && <span>DEEP INVESTIGATION PERFORMED IN THE SAME SESSION</span>}</section>
    <section className={`explanation ${explanation.status === "unavailable" ? "explanation-unavailable" : ""}`}><div className="eyebrow">GEMINI / EXPLANATION LAYER</div>{explanation.status === "unavailable" ? <><h3>AI explanation unavailable.</h3><p>The deterministic investigation and score remain valid.</p><small className="explanation-status">Evidence analysis completed successfully.</small></> : <><h3>THE EVIDENCE,<br/>IN PLAIN LANGUAGE.</h3><p>{explanation.reasoning}</p><ul>{explanation.evidenceBullets?.map(x => <li key={x}>{x}</li>)}</ul></>}</section>
    {report.humanApprovalRequired && <footer className="review"><span><i/> PENDING HUMAN REVIEW</span><p>Evidence has been collected and scored. Review findings before publishing or taking consequential action.</p></footer>}
  </main>;
}

export default function App() {
  const progress = useScrollProgress();
  const forceIntro = new URLSearchParams(window.location.search).get("intro") === "1";
  const [showIntro, setShowIntro] = useState(() => forceIntro || sessionStorage.getItem("prism-intro-seen") !== "1");
  const [url, setUrl] = useState("https://example.com");
  const [status, setStatus] = useState("idle");
  const [phases, setPhases] = useState([]);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const abortRef = useRef(null);
  const investigate = async (event) => {
    event?.preventDefault(); setError(""); setPhases([]); setReport(null);
    let normalized = url.trim(); if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`; setUrl(normalized);
    setStatus("running"); document.querySelector("#investigate")?.scrollIntoView({ behavior: "smooth" });
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/investigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: normalized }), signal: controller.signal });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Investigation request failed."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) { const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) { if (!line.trim()) continue; const message = JSON.parse(line); if (message.type === "phase") setPhases(p => [...p, message]); if (message.type === "complete") { setReport(message.report); setStatus("complete"); setTimeout(() => document.querySelector("#report")?.scrollIntoView({ behavior: "smooth" }), 50); } if (message.type === "error") throw new Error(message.error); }
        if (done) break;
      }
    } catch (err) { if (err.name !== "AbortError") { setError(err.message); setStatus("error"); } }
  };
  useEffect(() => () => abortRef.current?.abort(), []);
  const dismissIntro = useCallback(() => { sessionStorage.setItem("prism-intro-seen", "1"); setShowIntro(false); }, []);
  if (report) return <Report report={report} onReset={() => { setReport(null); setStatus("idle"); setPhases([]); window.scrollTo(0, 0); }}/>
  return <div id="top">{showIntro && <Intro onDone={dismissIntro}/>}<nav><a href="#top" className="brand">PRISM<i/></a><div><a href="#story">HOW IT WORKS</a><a href="#investigate">INVESTIGATE</a><a href="https://github.com/6289subhasree/prism-agent" target="_blank" rel="noreferrer">GITHUB</a></div></nav>
    <NetworkWorld progress={progress}/>
    <div className="story" id="story">
      <section className="scene hero"><div><div className="scene-no">01 / THE SURFACE <span>SESSION / IDLE</span></div><h1>YOU OPENED<br/>ONE WEBSITE.</h1><div className="hero-twist">Your browser didn’t.</div><h2>PRISM SEES THE TRAIL.</h2><p>An autonomous browser agent that follows third-party connections, sensitive data flows and tracking signals as they happen.</p><UrlForm value={url} onChange={setUrl} onSubmit={investigate}/></div><div className="scroll-cue">SCROLL TO LOOK BENEATH <i>↓</i></div></section>
      <section className="scene beneath"><div className="quiet-copy"><div className="scene-no">02 / BENEATH THE PAGE <span>LAYERS / 04</span></div><h2>A page is more than<br/>what it shows you.</h2><p>The interface is only the surface. PRISM separates the document, forms, scripts and requests beneath it.</p></div><div className="micro-observation">SURFACE / SEPARATING<br/><span>DEPTH + 042</span></div></section>
      <section className="scene trail"><div className="scene-no">03 / THE TRAIL <span>NETWORK / ACTIVE</span></div><h2>ONE PAGE.<br/>DOZENS OF<br/>CONVERSATIONS.</h2><p>Behind a single page load, your browser may quietly communicate with services you never see. Third-party activity is evidence—not automatically a violation.</p><div className="trail-meta">REQUEST / 014&nbsp;&nbsp; GET&nbsp;&nbsp; SCRIPT&nbsp;&nbsp; THIRD PARTY</div></section>
      <section className="scene refraction"><div className="refraction-copy"><div className="scene-no">04 / REFRACTION <span>SIGNAL / RESOLVING</span></div><h2><strong>PRISM</strong><br/>makes the invisible legible.</h2><p>Raw activity resolves into observed behavior and responsible heuristic categories.</p></div></section>
      <section className="scene agent"><div className="agent-copy"><div className="scene-no">05 / THE AGENT <span>POLICY / DETERMINISTIC</span></div><h2>PRISM follows the trail.</h2><p>It chooses whether to stop or investigate deeper. ACT is a decision, not a fixed performance.</p></div><AgentMap/></section>
    </div>
    <Investigation url={url} setUrl={setUrl} status={status} phases={phases} error={error} onSubmit={investigate}/>
  </div>;
}
