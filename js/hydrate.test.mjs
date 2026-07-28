import { test } from 'node:test';
import assert from 'node:assert';
import { hydrate } from './hydrate.mjs';

async function run(templateStream, data, streams) {
  const { resolvedStream, mapStream, bodyStream } = hydrate(templateStream, data, streams);
  let head = '';
  for await (const c of resolvedStream) head += c;
  const map = [];
  for await (const m of mapStream) map.push(m);
  const reader = bodyStream.getReader();
  const bytes = [];
  for (;;) { const { value, done } = await reader.read(); if (done) break; bytes.push(...value); }
  return { head, map, body: new TextDecoder().decode(Uint8Array.from(bytes)) };
}

test('conforms to the contract shape: sync return, correct types', () => {
  const { resolvedStream, mapStream, bodyStream } = hydrate('GET / HTTP/1.1\n', {});
  assert.equal(typeof resolvedStream[Symbol.asyncIterator], 'function');
  assert.equal(typeof mapStream[Symbol.asyncIterator], 'function');
  assert.ok(bodyStream instanceof ReadableStream);
});

test('substitutes tags in head and body, with the index-shift map', async () => {
  const { head, map, body } = await run(
    'POST /{{ p | url }} HTTP/1.1\nHost: x\n\nhi {{ n | raw }}\n',
    { p: 'a b', n: 7 }
  );
  assert.equal(head, 'POST /a%20b HTTP/1.1\nHost: x');
  assert.equal(body, 'hi 7\n');
  assert.deepEqual(map, [
    { 'hydrated-start': 6, 'original-start': 6, 'hydrated-length': 5, 'original-length': 13 },
    { 'hydrated-start': 33, 'original-start': 41, 'hydrated-length': 1, 'original-length': 13 },
  ]);
});

test("a body's own blank lines are preserved (only the first boundary splits)", async () => {
  const { head, body } = await run('A B\nH: x\n\nb1\n\nb2\n', {});
  assert.equal(head, 'A B\nH: x');
  assert.equal(body, 'b1\n\nb2\n');
});

test('accepts a Web ReadableStream template, chunked byte-at-a-time', async () => {
  const template = 'GET /{{ q | url }} HTTP/1.1\nHost: {{ h | raw }}\n\nok\n';
  const data = { q: 'a b', h: 'x' };
  const bytes = new TextEncoder().encode(template);
  const stream = new ReadableStream({
    start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); },
  });
  const trickled = await run(stream, data);
  const whole = await run(template, data);
  assert.deepEqual(trickled, whole);
});

test('provided body: streams[0] is the body, shadow text is ignored', async () => {
  const { head, body } = await run(
    'PUT /u HTTP/1.1\n:httpt-body-type: provided\n\nshadow — ignore me\n',
    {},
    ['real body']
  );
  assert.match(head, /provided/);
  assert.equal(body, 'real body');
});

test('an unknown filter fails resolvedStream, mapStream, and bodyStream alike', async () => {
  const { resolvedStream, mapStream, bodyStream } = hydrate('GET /{{ x | nope }} HTTP/1.1\n', { x: 1 });
  const drain = async (iterable, isBody) => {
    try {
      if (isBody) { const r = iterable.getReader(); for (;;) { const { done } = await r.read(); if (done) break; } }
      else { for await (const _ of iterable) {} }
      return null;
    } catch (e) { return e.name; }
  };
  assert.equal(await drain(resolvedStream), 'TemplateSyntaxError');
  assert.equal(await drain(mapStream), 'TemplateSyntaxError');
  assert.equal(await drain(bodyStream, true), 'TemplateSyntaxError');
});
