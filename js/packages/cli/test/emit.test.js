const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { ReadableStream } = require('node:stream/web');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchCurl } = require('../src/commands/emit.js');
const { createEchoServer, binarizeIr, loadE2eFixtures, normalizeForEchoServer } = require('../../test-utils/index.js');

test('dispatchCurl body type matrix', async () => {
  const serverObj = await createEchoServer();
  const port = serverObj.port;

  async function runCase(bodyConfig, expectedContentString, method = 'POST', bodyStream = null) {
    const mockIR = {
      'schema-version': '1.0', method, host: `localhost:${port}`, uri: '/', version: 'HTTP/1.1', headers: []
    };
    if (bodyConfig !== undefined) mockIR.body = bodyConfig;

    const requestPromise = serverObj.nextRequest();

    const p = dispatchCurl(mockIR, 'http', bodyStream);

    const serverIR = await requestPromise;
    const testIR = binarizeIr(mockIR, expectedContentString);
    assert.deepEqual(serverIR, testIR);
    await p;
  }

  try {
    await runCase(undefined, '', 'GET'); // 1
    await runCase({ type: 'text', content: 'hello' }, 'hello'); // 2
    await runCase({ type: 'base64', content: Buffer.from('binary').toString('base64') }, 'binary'); // 3
    await runCase({ type: 'json', content: { foo: 'bar' } }, '{"foo":"bar"}'); // 4

    const stream = new ReadableStream({ start(c) { c.enqueue(Buffer.from('streamed')); c.close(); }});
    await runCase({ type: 'provided' }, 'streamed', 'POST', stream); // 5

    await runCase({ type: 'text', content: '{"looks":"like json"}' }, '{"looks":"like json"}'); // 7

    // 6. Unknown Type
    await assert.rejects(
      dispatchCurl({ method: 'POST', host: `localhost:${port}`, uri: '/', headers: [], body: { type: 'magic' } }, 'http', null),
      /Unsupported httpt-ir body type: magic/
    );
  } finally {
    await serverObj.close();
  }
});

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
