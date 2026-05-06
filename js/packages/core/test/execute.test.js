const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { executeWithFetch } = require('../src/execute.js');

test('executeWithFetch sends correct HTTP request over the wire', async () => {
  // 1. Stand up the local echo server
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body
      }));
    });
  });

  // 2. Listen on port 0 to let the OS assign a random free port
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  // 3. Define a mock IR
  const mockIR = {
    'schema-version': '1.0',
    method: 'POST',
    host: `localhost:${port}`,
    uri: '/api/submit?foo=bar',
    version: 'HTTP/1.1',
    headers: [
      { name: 'X-Custom-Auth', value: 'secret' },
      { name: 'Content-Type', value: 'application/json' }
    ]
  };

  try {
    // 4. Execute the sink against the local server (force 'http' scheme)
    const response = await executeWithFetch(mockIR, null, 'http');
    const echo = await response.json();

    // 5. Assert the server received exactly what we expected
    assert.strictEqual(echo.method, 'POST');
    assert.strictEqual(echo.url, '/api/submit?foo=bar');
    assert.strictEqual(echo.headers['x-custom-auth'], 'secret');
    assert.strictEqual(echo.headers['content-type'], 'application/json');
  } finally {
    // 6. Tear down the server
    server.close();
  }
});
