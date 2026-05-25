const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { hydrate, parse } = require('../src/pipeline.js');
const { loadE2eFixtures } = require('../../test-utils/index.js');

describe('Pipeline: Hydrate & Parse', () => {
  const fixturesPath = path.join(__dirname, '../../../../test-fixtures/e2e');
  const fixtures = loadE2eFixtures(fixturesPath);

  for (const fixture of fixtures) {
    it(`should process ${fixture.irFile} correctly`, async () => {
      const hydrated = await hydrate();
      const parsed = parse(hydrated.resolved, hydrated.bodyStream);

      assert.deepStrictEqual(parsed.ir, fixture.ir);
    });
  }
});
