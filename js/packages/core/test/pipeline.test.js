const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hydrate, parse } = require('../src/pipeline.js');
const { loadE2eFixtures } = require('@httpt/test-utils');

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n/g, '\n');
}

describe('Pipeline: Hydrate & Parse', () => {
  const fixtures = loadE2eFixtures();

  for (const fixture of fixtures) {
    const nameToLog = fixture.irFile || fixture.baseName;
    if (fixture.error) {
      it(`should throw ${fixture.error.name} for ${nameToLog}`, async () => {
        await assert.rejects(
          async () => {
            const { resolved, bodyStream } = await hydrate(fixture.template, fixture.data, fixture.dataStreams);
            parse(resolved, bodyStream);
          },
          (err) => err.name === fixture.error.name
        );
      });
      continue;
    }
    it(`should process ${nameToLog} correctly`, async () => {
      const { resolved, map, bodyStream } = await hydrate(fixture.template, fixture.data, fixture.dataStreams);
      assert.equal(normalizeLineEndings(resolved), normalizeLineEndings(fixture.resolved));
      assert.deepEqual(map, fixture.map);

      const { ir } = parse(resolved, bodyStream);
      assert.deepEqual(ir, fixture.ir);
    });
  }

  it('should apply chained hydrate functions from left to right', () => {
    const template = 'GET /search?q={{ term | json-string | url }} HTTP/1.1\r\nHost: example.com\r\n';
    const { resolved } = hydrate(template, { term: 'a "quoted" value' });

    assert.equal(
      resolved,
      'GET /search?q=a%20%5C%22quoted%5C%22%20value HTTP/1.1\r\nHost: example.com\r\n'
    );
  });

  it('should hand off dynamic provided bodies without serializing the stream index', () => {
    const stream = Buffer.from('stream body');
    const template = 'POST /upload HTTP/1.1\r\nHost: example.com\r\n';
    const { resolved, bodyStream } = hydrate(template, { body: { type: 'provided', content: 0 } }, [stream]);
    const { ir, bodyStream: parsedBodyStream } = parse(resolved, bodyStream);

    assert.equal(resolved.endsWith('\r\n:httpt-body-type: provided\r\n'), true);
    assert.strictEqual(parsedBodyStream, stream);
    assert.deepEqual(ir.body, { type: 'provided', content: 0 });
  });

  it('should reject template body content before resolving body placeholders when data.body is provided', () => {
    const template = 'POST /upload HTTP/1.1\nHost: example.com\n\n{{ missing | raw }}';

    assert.throws(
      () => hydrate(template, { body: { type: 'text', content: 'dynamic body' } }),
      (error) => error.name === 'BodyConflictError'
    );
  });
});
