const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { ReadableStream } = require('node:stream/web');
const { dispatchFetch } = require('../src/dispatch.js');
const { createEchoServer, binarizeIr, loadE2eFixtures, normalizeForEchoServer } = require('@httpt/test-utils');

test('E2E fixtures execution against echo server', async () => {
  const serverObj = await createEchoServer();
  const port = serverObj.port;

  // The E2E fixtures are located three directories up from this test file
  const fixturesDir = path.join(__dirname, '../../../../test-fixtures/e2e');
  const fixtures = loadE2eFixtures(fixturesDir);

  try {
    for (const fixture of fixtures) {
      const { irFile, ir, streamContent, streamFilePath } = fixture;

      // Override host to point to our local echo server
      ir.host = `localhost:${port}`;

      let bodyStream = null;

      if (streamFilePath) {
        // Provide a live Web Stream to dispatchFetch (Node fetch requires Web Streams)
        bodyStream = Readable.toWeb(fs.createReadStream(streamFilePath));
      }

      const requestPromise = serverObj.nextRequest();

      // Execute the IR payload
      const res = await dispatchFetch(ir, 'http', bodyStream);
      const serverIR = await res.json();

      // The echo server transforms the payload into a base64 IR format.
      // We use binarizeIr to transform our source IR into that same expected format.
      const expectedIR = binarizeIr(ir, streamContent);

      normalizeForEchoServer(expectedIR, serverIR, 'fetch');

      assert.deepEqual(serverIR, expectedIR, `E2E fixture execution failed for: ${irFile}`);
    }
  } finally {
    await serverObj.close();
  }
});
