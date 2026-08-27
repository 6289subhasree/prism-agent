const test = require("node:test");
const assert = require("node:assert/strict");

const { _testing } = require("./controller");

test("webcmdExecutable prefers the project-local package entry", () => {
  assert.deepEqual(_testing.webcmdExecutable(), {
    executable: process.execPath,
    prefixArgs: [require.resolve("@agentrhq/webcmd")],
  });
});

test("parseJsonOutput accepts clean JSON", () => {
  assert.deepEqual(_testing.parseJsonOutput('{"ok":true}', "test"), { ok: true });
});

test("parseJsonOutput ignores a runtime banner", () => {
  const output = "CloakBrowser startup banner\r\nhttps://example.test\r\n{\"connectivity\":{\"ok\":true}}";
  assert.deepEqual(_testing.parseJsonOutput(output, "doctor"), {
    connectivity: { ok: true },
  });
});

test("preflight validates the CLI version and healthy browser bridge", () => {
  const calls = [];
  const result = _testing.preflightWebcmd(1234, (args, timeout) => {
    calls.push({ args, timeout });
    if (args[0] === "--version") return "0.7.8\n";
    return JSON.stringify({
      binary: { installed: true },
      connectivity: { ok: true },
      issues: [],
    });
  });

  assert.equal(result.version, "0.7.8");
  assert.deepEqual(calls.map((call) => call.args), [
    ["--version"],
    ["doctor", "--json"],
  ]);
  assert.ok(calls.every((call) => call.timeout > 0 && call.timeout <= 1234));
});

test("preflight reports doctor issues when the bridge is unhealthy", () => {
  assert.throws(
    () => _testing.preflightWebcmd(1234, (args) => {
      if (args[0] === "--version") return "0.7.8";
      return JSON.stringify({
        binary: { installed: true },
        connectivity: { ok: false, error: "daemon failed" },
        issues: ["Daemon is not running.", "Connectivity test failed."],
      });
    }),
    /Webcmd preflight failed.*Daemon is not running\. Connectivity test failed\./
  );
});

test("preflight rejects malformed version output", () => {
  assert.throws(
    () => _testing.preflightWebcmd(1234, () => "not-a-version"),
    /invalid version/
  );
});

test("preflight gives the required action when Webcmd is unavailable", () => {
  assert.throws(
    () => _testing.preflightWebcmd(1234, () => {
      const error = new Error("spawn failed");
      error.code = "ENOENT";
      throw error;
    }),
    (error) => error.message === "Webcmd is unavailable. Run npm install, then npm run prism:doctor before investigating."
  );
});
