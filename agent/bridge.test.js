const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { WORKFLOW_PREFIX } = require('./progress');

// Exercise the actual API handler with a controllable child process. No live
// browser or port is needed to verify the child-stdout -> NDJSON boundary.
function bridge() {
  let handler;
  const app = { use() {}, get() {}, post(_route, fn) { handler = fn; }, listen() {} };
  const express = Object.assign(() => app, { json: () => () => {} });
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() { this.killed = true; } });
  const root = path.join(__dirname, '..');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'child_process' ? { spawn: () => child } : name === './agent/progress' ? require('./progress') : require(name),
    __dirname: root, console, URL,
    process: { env: {}, execPath: process.execPath, loadEnvFile() {} },
  });
  const messages = [];
  const response = Object.assign(new EventEmitter(), {
    status() { return this; }, setHeader() {}, flushHeaders() {},
    write(line) { messages.push(JSON.parse(line)); },
    end() { this.writableEnded = true; },
  });
  handler({ body: { url: 'https://example.com' } }, response);
  return { child, messages, response };
}
const event = {
  schemaVersion: 'prism.workflow.v1', investigationId: '8f4ddad6-e6bb-47de-a4cb-22c5c8c67588',
  sequence: 0, type: 'agent.started', agentId: 'consent-comparison', at: '2026-09-23T12:00:00.000Z', detail: 'Comparing choices →',
};

test('bridge forwards fragmented Unicode progress and retains the final report', () => {
  const f = bridge();
  const bytes = Buffer.from(WORKFLOW_PREFIX + JSON.stringify(event) + '\n');
  for (const byte of bytes) f.child.stdout.write(Buffer.from([byte]));
  f.child.stdout.write(WORKFLOW_PREFIX + '{bad json}\n');
  f.child.stdout.write('=== FINAL REPORT (pending human review before publishing) ===\n');
  const report = { investigatedUrl: 'https://example.com', workflow: { events: [event] } };
  f.child.stdout.write(JSON.stringify(report));
  f.child.emit('close', 0);
  assert.deepEqual(f.messages.map(m => m.type), ['started', 'workflow', 'complete']);
  assert.deepEqual(f.messages[1].event, event);
  assert.deepEqual(f.messages[2].report, report);
  assert.equal(f.response.writableEnded, true);
});

test('bridge preserves streamed stage failure before the terminal API error', () => {
  const f = bridge();
  const failure = { ...event, type: 'agent.failed', error: { code: 'TIMEOUT', message: 'browser timeout' } };
  f.child.stdout.write(WORKFLOW_PREFIX + JSON.stringify(failure));
  f.child.stderr.write('Reason: browser timeout');
  f.child.emit('close', 1);
  assert.deepEqual(f.messages.map(m => m.type), ['started', 'workflow', 'error']);
  assert.equal(f.messages[1].event.error.code, 'TIMEOUT');
  assert.match(f.messages[2].error, /browser timeout/);
});

test('bridge forwards partial-stage reasons unchanged', () => {
  const f = bridge();
  const partial = { ...event, type: 'agent.partial', warnings: ['reject: No unambiguous visible control; no click performed'] };
  f.child.stdout.write(WORKFLOW_PREFIX + JSON.stringify(partial) + '\n');
  assert.deepEqual(f.messages[1].event, partial);
});
