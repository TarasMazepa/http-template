const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hydrate, parse } = require('../src/pipeline.js');
const { loadE2eFixtures } = require('@httpt/test-utils');

describe('Pipeline: Hydrate & Parse', () => {
  const fixtures = loadE2eFixtures();

  for (const fixture of fixtures) {
    if (fixture.error) {
      continue; // Skip testing expected error fixtures in the basic pipeline test
    }
    const nameToLog = fixture.irFile || fixture.baseName;
    it(`should process ${nameToLog} correctly`, { todo: true }, async () => {
      const { resolved, bodyStream } = await hydrate(fixture.template, fixture.data);
      const { ir } = parse(resolved, bodyStream);
      assert.deepEqual(ir, fixture.ir);
    });
  }
});
