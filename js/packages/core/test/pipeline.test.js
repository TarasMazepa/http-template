const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hydrate, parse } = require('../src/pipeline.js');
const { loadE2eFixtures } = require('@httpt/test-utils');

describe('Pipeline: Hydrate & Parse', () => {
  const fixtures = loadE2eFixtures();

  for (const fixture of fixtures) {
    const nameToLog = fixture.irFile || fixture.baseName;
    if (fixture.error) {
      it(`should throw ${fixture.error.name} for ${nameToLog}`, { todo: true }, async () => {
        await assert.rejects(
          async () => {
            const { resolved, bodyStream } = await hydrate(fixture.template, fixture.data);
            parse(resolved, bodyStream);
          },
          (err) => err.name === fixture.error.name
        );
      });
      continue;
    }
    it(`should process ${nameToLog} correctly`, { todo: true }, async () => {
      const { resolved, bodyStream } = await hydrate(fixture.template, fixture.data);
      const { ir } = parse(resolved, bodyStream);
      assert.deepEqual(ir, fixture.ir);
    });
  }

  it('should hydrate raw and url tags in one pass', async () => {
    const template = 'GET /users/{{ user-id | url }} HTTP/1.1\nHost: {{ host | raw }}\n';
    const { resolved } = await hydrate(template, {
      'user-id': 'a b',
      host: 'api.example.com',
    });

    assert.equal(resolved, 'GET /users/a%20b HTTP/1.1\nHost: api.example.com\n');
  });

  it('should record source map entries while hydrating tags', async () => {
    const template = 'GET /{{ path | url }} HTTP/1.1\n';
    const { map } = await hydrate(template, { path: 'a b' });

    assert.deepEqual(map, [
      {
        'hydrated-start': 5,
        'original-start': 5,
        'hydrated-length': 5,
        'original-length': 16,
      },
    ]);
  });
});
