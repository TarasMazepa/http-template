const fs = require('node:fs');
const { Readable } = require('node:stream');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { dispatchFetch } = require('../src/dispatch.js');
const { createEchoServer, binarizeIr, loadE2eFixtures, normalizeForEchoServer } = require('@httpt/test-utils');

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

  const fixtures = loadE2eFixtures();

  for (const fixture of fixtures) {
    it(`should execute ${fixture.irFile} correctly`, async () => {
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
    });
  }
});
