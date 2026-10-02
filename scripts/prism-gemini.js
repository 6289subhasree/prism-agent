const path = require("node:path");
const { geminiConfig } = require("../agent/gemini-config");
const { requestGeminiJson } = require("../agent/gemini-request");

async function checkGemini({ env = process.env, request = requestGeminiJson, log = console.log } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  try {
    if (!apiKey) throw Object.assign(new Error("GEMINI_API_KEY is not configured in .env or this terminal"), { code: "GEMINI_KEY_MISSING" });
    const { model, timeoutMs } = geminiConfig(env);
    log(`Checking Gemini model ${model}; timeout ${timeoutMs / 1000}s. No browser or website evidence is used.`);
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Return exactly this JSON object: {"ok":true}' }] }], generationConfig: { responseMimeType: "application/json" } }),
    }, { budgetMs: timeoutMs });
    const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("");
    let result;
    try { result = JSON.parse(text); } catch { throw Object.assign(new Error("Gemini returned no usable JSON response"), { code: "GEMINI_RESPONSE_INVALID" }); }
    if (result?.ok !== true) throw Object.assign(new Error("Gemini responded but did not return the requested probe result"), { code: "GEMINI_RESPONSE_INVALID" });
    log("PASS: Gemini returned the requested JSON. This checks connectivity and model access; the full explanation still needs a live investigation.");
    return true;
  } catch (error) {
    const safeMessage = apiKey ? String(error.message).replaceAll(apiKey, "[redacted]").replaceAll(encodeURIComponent(apiKey), "[redacted]") : error.message;
    log(`FAIL: ${error.code || "GEMINI_CHECK_FAILED"}: ${safeMessage}`);
    const action = {
      GEMINI_KEY_MISSING: "Set GEMINI_API_KEY in the project .env, then rerun this command. Do not share the key.",
      GEMINI_HTTP_404: "Check GEMINI_MODEL against a model available to your API key, then rerun this command.",
      GEMINI_HTTP_400: "Check the API error above for model or request configuration details.",
      GEMINI_HTTP_401: "Check your Gemini API key locally.",
      GEMINI_HTTP_403: "Check the API key permissions and project access locally.",
      GEMINI_HTTP_429: "Check the API project's quota before retrying.",
      GEMINI_TIMEOUT: "The minimal request also timed out. Check connectivity, VPN/proxy settings and provider availability; share this output without your key.",
      GEMINI_NETWORK: "Check connectivity and VPN/proxy settings; share this output without your key.",
    }[error.code] || "Check the error above and rerun after correcting it; share this output without your key.";
    log(`Action: ${action}`);
    return false;
  }
}

if (require.main === module) {
  try { process.loadEnvFile(path.join(__dirname, "..", ".env")); }
  catch (error) { if (error.code !== "ENOENT") { console.error("Could not load the project .env file"); process.exit(1); } }
  checkGemini().then(ok => { process.exitCode = ok ? 0 : 1; });
}
module.exports = { checkGemini };
