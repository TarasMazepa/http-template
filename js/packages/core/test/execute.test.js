const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Buffer } = require('node:buffer');
const { ReadableStream } = require('node:stream/web');
const { executeWithFetch } = require('../src/execute.js');

test('executeWithFetch body type matrix', async () => {
  let capturedRequest = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      capturedRequest = { method: req.method, body };
      res.writeHead(200);
      res.end();
    });
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  async function runCase(bodyConfig, expectedBody, method = 'POST', bodyStream = null) {
    const mockIR = {
      'schema-version': '1.0', method, host: `localhost:${port}`, uri: '/', version: 'HTTP/1.1', headers: []
    };
    if (bodyConfig !== undefined) mockIR.body = bodyConfig;

    await executeWithFetch(mockIR, bodyStream, 'http');
    assert.strictEqual(capturedRequest.body, expectedBody, `Failed on ${bodyConfig?.type || 'no body'}`);
  }

  try {
    // 1. No Body
    await runCase(undefined, '', 'GET');
    // 2. Text
    await runCase({ type: 'text', content: 'hello' }, 'hello');
    // 3. Base64
    await runCase({ type: 'base64', content: Buffer.from('binary').toString('base64') }, 'binary');
    // 4. JSON
    await runCase({ type: 'json', content: { foo: 'bar' } }, '{"foo":"bar"}');
    // 5. Provided
    const stream = new ReadableStream({ start(c) { c.enqueue(Buffer.from('streamed')); c.close(); }});
    await runCase({ type: 'provided' }, 'streamed', 'POST', stream);
    // 7. Mismatch (Text type containing JSON string should not be altered)
    await runCase({ type: 'text', content: '{"looks":"like json"}' }, '{"looks":"like json"}');

    // 6. Unknown Type
    await assert.rejects(
      executeWithFetch({ method: 'POST', host: `localhost:${port}`, uri: '/', headers: [], body: { type: 'magic' } }, null, 'http'),
      /Unsupported httpt-ir body type: magic/
    );
  } finally {
    server.close();
  }
});
