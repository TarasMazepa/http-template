const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { ReadableStream } = require('node:stream/web');
const { executeFetch } = require('../src/execute.js');
const { createEchoServer, binarizeIr } = require('../../test-utils/index.js');

test('executeFetch body type matrix', async () => {
  const serverObj = await createEchoServer();
  const port = serverObj.port;

  async function runCase(bodyConfig, expectedContentString, method = 'POST', bodyStream = null) {
    const mockIR = {
      'schema-version': '1.0', method, host: `localhost:${port}`, uri: '/', version: 'HTTP/1.1', headers: []
    };
    if (bodyConfig !== undefined) mockIR.body = bodyConfig;

    const res = await executeFetch(mockIR, 'http', bodyStream);
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
      executeFetch({ method: 'POST', host: `localhost:${port}`, uri: '/', headers: [], body: { type: 'magic' } }, 'http', null),
      /Unsupported httpt-ir body type: magic/
    );
  } finally {
    await serverObj.close();
  }
});
