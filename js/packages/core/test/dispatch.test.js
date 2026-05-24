const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ReadableStream } = require('node:stream/web');
const { dispatchFetch } = require('../src/dispatch.js');
const { createEchoServer, binarizeIr } = require('../../test-utils/index.js');

test('dispatchFetch body type matrix', async () => {
  const serverObj = await createEchoServer();
  const port = serverObj.port;

  async function runCase(bodyConfig, expectedContentString, method = 'POST', bodyStream = null) {
    const mockIR = {
      'schema-version': '1.0', method, host: `localhost:${port}`, uri: '/', version: 'HTTP/1.1', headers: []
    };
    if (bodyConfig !== undefined) mockIR.body = bodyConfig;

    const res = await dispatchFetch(mockIR, 'http', bodyStream);
    const serverIR = await res.json();

    const testIR = binarizeIr(mockIR, expectedContentString);
    assert.deepEqual(serverIR, testIR);
  }

  try {
    await runCase(undefined, '', 'GET');
    await runCase({ type: 'text', content: 'hello' }, 'hello');
    await runCase({ type: 'base64', content: Buffer.from('binary').toString('base64') }, 'binary');
    await runCase({ type: 'json', content: { foo: 'bar' } }, '{"foo":"bar"}');

    const stream = new ReadableStream({ start(c) { c.enqueue(Buffer.from('streamed')); c.close(); }});
    await runCase({ type: 'provided' }, 'streamed', 'POST', stream);

    await runCase({ type: 'text', content: '{"looks":"like json"}' }, '{"looks":"like json"}');

    await assert.rejects(
      dispatchFetch({ method: 'POST', host: `localhost:${port}`, uri: '/', headers: [], body: { type: 'magic' } }, 'http', null),
      /Unsupported httpt-ir body type: magic/
    );
  } finally {
    await serverObj.close();
  }
});

test('E2E fixtures execution against echo server', async () => {
  const serverObj = await createEchoServer();
  const port = serverObj.port;

  // The E2E fixtures are located three directories up from this test file
  const fixturesDir = path.join(__dirname, '../../../../test-fixtures/e2e');

  const files = fs.readdirSync(fixturesDir);
  const irFiles = files.filter(f => f.endsWith('.httpt-ir'));

  try {
    for (const irFile of irFiles) {
      console.log(`Running ${irFile}`);
      const irPath = path.join(fixturesDir, irFile);
      const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));

      // Override host to point to our local echo server
      ir.host = `localhost:${port}`;

      let bodyStream = null;
      let streamContent = null;

      // Strictly locate out-of-band streams using our new naming convention
      if (ir.body && ir.body.type === 'provided') {
        const streamIndex = ir.body.content !== undefined ? ir.body.content : 0;
        const streamFileName = `${irFile}-provided-stream-${streamIndex}`;
        const streamFilePath = path.join(fixturesDir, streamFileName);

        if (fs.existsSync(streamFilePath)) {
          // Load into memory purely for the binarizeIr assertion check
          streamContent = fs.readFileSync(streamFilePath, 'utf8');
          // Provide a live Web Stream to dispatchFetch (Node fetch requires Web Streams)
          bodyStream = Readable.toWeb(fs.createReadStream(streamFilePath));
        }
      }

      const requestPromise = serverObj.nextRequest();

      // Execute the IR payload
      const res = await dispatchFetch(ir, 'http', bodyStream);
      const serverIR = await res.json();

      // The echo server transforms the payload into a base64 IR format.
      // We use binarizeIr to transform our source IR into that same expected format.
      const expectedIR = binarizeIr(ir, streamContent);

      if (['GET', 'HEAD'].includes(expectedIR.method)) {
        delete expectedIR.body;
      }

      expectedIR.headers = expectedIR.headers.map(h => ({ name: h.name.toLowerCase(), value: h.value }));
      serverIR.headers = serverIR.headers.map(h => ({ name: h.name.toLowerCase(), value: h.value }));

      // The echo server ignores certain headers, so we must strip them from the expected IR
      expectedIR.headers = expectedIR.headers.filter(h => {
        const name = h.name.toLowerCase();
        return name !== 'host' &&
            name !== 'connection' &&
            name !== 'accept' &&
            name !== 'accept-language' &&
            name !== 'sec-fetch-mode' &&
            name !== 'user-agent' &&
            name !== 'accept-encoding' &&
            name !== 'content-length' &&
            name !== 'content-type' &&
            name !== 'transfer-encoding';
      });

      assert.deepEqual(serverIR, expectedIR, `E2E fixture execution failed for: ${irFile}`);
    }
  } finally {
    await serverObj.close();
  }
});
