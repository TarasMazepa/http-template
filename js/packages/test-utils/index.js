const http = require('node:http');
const { Buffer } = require('node:buffer');

/**
 * Starts an HTTP echo server on a random port.
 * Returns a server object with a method `getCapturedRequest()` that waits for a request,
 * parses it into httpt-ir format, and resolves it.
 */
function createEchoServer() {
  let resolvers = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);

      const ir = {
        'schema-version': '1.0',
        method: req.method,
        host: req.headers.host || '',
        uri: req.url,
        version: `HTTP/${req.httpVersion}`,
        headers: []
      };

      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        if (
            name.toLowerCase() !== 'host' &&
            name.toLowerCase() !== 'connection' &&
            name.toLowerCase() !== 'accept' &&
            name.toLowerCase() !== 'accept-language' &&
            name.toLowerCase() !== 'sec-fetch-mode' &&
            name.toLowerCase() !== 'user-agent' &&
            name.toLowerCase() !== 'accept-encoding' &&
            name.toLowerCase() !== 'content-length' &&
            name.toLowerCase() !== 'content-type' &&
            name.toLowerCase() !== 'transfer-encoding'
        ) {
           ir.headers.push({ name: req.rawHeaders[i], value: req.rawHeaders[i + 1] });
        }
      }

      if (rawBody.length > 0) {
        ir.body = {
          type: 'base64',
          content: rawBody.toString('base64')
        };
      }

      const resolve = resolvers.shift();
      if (resolve) resolve(ir);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ir));
    });
  });

  return new Promise(resolve => {
    server.listen(0, () => {
      resolve({
        server,
        port: server.address().port,
        close: () => new Promise(r => server.close(r)),
        nextRequest: () => new Promise(res => resolvers.push(res))
      });
    });
  });
}

function binarizeIr(ir, providedContent = null) {
  const result = JSON.parse(JSON.stringify(ir));

  if (result.body) {
    let rawBuffer;
    switch (result.body.type) {
      case 'text':
        rawBuffer = Buffer.from(result.body.content, 'utf8');
        break;
      case 'json':
        rawBuffer = Buffer.from(JSON.stringify(result.body.content), 'utf8');
        break;
      case 'base64':
        rawBuffer = Buffer.from(result.body.content, 'base64');
        break;
      case 'provided':
        rawBuffer = providedContent ? Buffer.from(providedContent, 'utf8') : Buffer.alloc(0);
        break;
      default:
        rawBuffer = Buffer.alloc(0);
    }

    if (rawBuffer.length > 0) {
      result.body = {
        type: 'base64',
        content: rawBuffer.toString('base64')
      };
    } else {
      delete result.body;
    }
  }
  return result;
}

module.exports = { createEchoServer, binarizeIr };
