const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { ReadableStream } = require('node:stream/web');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchCurl } = require('../src/commands/emit.js');
const { createEchoServer, binarizeIr, loadE2eFixtures, normalizeForEchoServer } = require('@httpt/test-utils');

test('E2E fixtures execution against echo server', async () => {
  const serverObj = await createEchoServer();
  const port = serverObj.port;

  const fixturesDir = path.join(__dirname, '../../../../test-fixtures/e2e');
  const fixtures = loadE2eFixtures(fixturesDir);

  try {
    for (const fixture of fixtures) {
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
    }
  } finally {
    await serverObj.close();
  }
});
