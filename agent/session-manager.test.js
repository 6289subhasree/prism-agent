const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionManager } = require("./session-manager");

function fixture({ failClose = false } = {}) {
  const calls = [];
  let count = 0;
  let budget = 100;
  const manager = createSessionManager({
    run(args, timeout) {
      calls.push({ args, timeout });
      if (args[1] === "create") return JSON.stringify({ session: `session-${++count}` });
      if (failClose) throw new Error("bridge unavailable");
    },
    parseJson: JSON.parse,
    remaining: () => budget,
  });
  return { manager, calls, expire() { budget = 0; } };
}

test("sessions have unique names, owned IDs and idempotent cleanup", () => {
  const { manager, calls } = fixture();
  const first = manager.open();
  const second = manager.open();
  assert.notEqual(first, second);
  assert.notEqual(calls[0].args[2], calls[1].args[2]);
  assert.equal(manager.close("someone-elses-session"), false);
  assert.equal(manager.close(first), true);
  assert.equal(manager.close(first), false);
  manager.closeAll();
  assert.deepEqual(manager.activeSessionIds, []);
  assert.equal(calls.length, 4);
});

test("cleanup still runs after investigation budget is exhausted", async () => {
  const { manager, calls, expire } = fixture();
  const failure = new Error("investigation timed out");
  await assert.rejects(manager.withSession(async () => { expire(); throw failure; }), e => e === failure);
  assert.equal(calls[1].timeout, 5000);
  assert.deepEqual(manager.activeSessionIds, []);
  assert.throws(() => manager.open(), /No time left/);
  assert.equal(calls.length, 2);
});

test("cleanup failure preserves result and records the unclosed session", async () => {
  const { manager } = fixture({ failClose: true });
  assert.equal(await manager.withSession(async () => 42), 42);
  assert.deepEqual(manager.activeSessionIds, ["session-1"]);
  assert.match(manager.warnings[0], /bridge unavailable/);
});

test("cleanup failure does not replace the original investigation failure", async () => {
  const { manager } = fixture({ failClose: true });
  const failure = new Error("page failed");
  await assert.rejects(manager.withSession(() => { throw failure; }), e => e === failure);
});

test("invalid session response never invokes the browser callback", async () => {
  const manager = createSessionManager({ run: () => '{}', parseJson: JSON.parse, remaining: () => 100 });
  let called = false;
  await assert.rejects(manager.withSession(() => { called = true; }), /valid session ID/);
  assert.equal(called, false);
  assert.deepEqual(manager.activeSessionIds, []);
});
