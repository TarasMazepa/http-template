const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { ReadableStream } = require('node:stream/web');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchCurl } = require('../src/commands/emit.js');
const { createEchoServer, binarizeIr, loadE2eFixtures, normalizeForEchoServer } = require('../../test-utils/index.js');

describe('E2E fixtures execution against echo server', () => {
  let serverObj;
  let port;

  before(async () => {
    serverObj = await createEchoServer();
    port = serverObj.port;
  });

  after(async () => {
    if (serverObj) {
      await serverObj.close();
    }
  });

  const fixturesDir = path.join(__dirname, '../../../../test-fixtures/e2e');
  const fixtures = loadE2eFixtures(fixturesDir);

  for (const fixture of fixtures) {
    it(`should execute ${fixture.irFile} correctly`, async () => {
      const { irFile, ir, streamContent, streamFilePath } = fixture;

      ir.host = `localhost:${port}`;

      let bodyStream = null;

      if (streamFilePath) {
        bodyStream = fs.createReadStream(streamFilePath);
      }

      const requestPromise = serverObj.nextRequest();

      const p = dispatchCurl(ir, 'http', bodyStream);

      const serverIR = await requestPromise;
      await p;

      const expectedIR = binarizeIr(ir, streamContent);

      normalizeForEchoServer(expectedIR, serverIR, 'curl');

      assert.deepEqual(serverIR, expectedIR, `E2E fixture execution failed for: ${irFile}`);
    });
  }
});
