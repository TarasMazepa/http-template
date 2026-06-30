const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hydrate, parse } = require('../src/pipeline.js');
const { loadE2eFixtures } = require('@httpt/test-utils');

describe('Pipeline: Hydrate & Parse', () => {
  const fixtures = loadE2eFixtures();

  for (const fixture of fixtures) {
    const nameToLog = fixture.irFile || fixture.baseName;
    if (fixture.error) {
      it(`should throw ${fixture.error.name} for ${nameToLog}`, async () => {
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
    it(`should process ${nameToLog} correctly`, async () => {
      const { resolved, bodyStream } = await hydrate(fixture.template, fixture.data);
      const { ir } = parse(resolved, bodyStream);
      assert.deepEqual(ir, fixture.ir);
    });
  }
});
