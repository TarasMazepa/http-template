const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hydrate } = require('../src/pipeline.js');
const { loadE2eFixtures } = require('@httpt/test-utils');

async function readText(stream) {
  const reader = stream.getReader();
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += value;
  }
}

describe('Pipeline: Hydrate & Parse', () => {
  const fixtures = loadE2eFixtures();

  for (const fixture of fixtures) {
    const nameToLog = fixture.irFile || fixture.baseName;
    if (fixture.error) {
      it(`should throw ${fixture.error.name} for ${nameToLog}`, { todo: true });
      continue;
    }
    it(`should process ${nameToLog} correctly`, { todo: true });
  }

  it('should return stream outputs synchronously', () => {
    const result = hydrate('GET / HTTP/1.1\n');

    assert.equal(typeof result.then, 'undefined');
    assert.equal(result.resolvedStream instanceof ReadableStream, true);
    assert.equal(result.mapStream instanceof ReadableStream, true);
    assert.equal(result.bodyStream instanceof ReadableStream, true);
  });

  it('should process template text in the detached worker', async () => {
    const { resolvedStream, mapStream, bodyStream } = hydrate('GET / HTTP/1.1\n');

    assert.equal(await readText(resolvedStream), 'GET / HTTP/1.1\n');
    assert.equal(await readText(mapStream), '');
    assert.equal(await readText(bodyStream), '');
  });
});
