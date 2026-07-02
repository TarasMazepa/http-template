const http = require('node:http');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');

const E2E_DIR = path.resolve(__dirname, '../../../test-fixtures/e2e');

const IGNORED_HEADERS = ['host', 'connection', 'accept', 'accept-language', 'sec-fetch-mode', 'user-agent', 'accept-encoding', 'content-length', 'content-type', 'transfer-encoding'];

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
        if (!IGNORED_HEADERS.includes(name.toLowerCase())) {
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

function getFixtureBaseNames() {
  const files = fs.readdirSync(E2E_DIR);
  return files.filter(f => f.endsWith('.httpt')).map(f => f.replace('.httpt', ''));
}

function loadReferencedStreams(referenceFileName) {
  const streams = [];

  for (let index = 0; ; index += 1) {
    const streamPath = path.join(E2E_DIR, `${referenceFileName}-provided-stream-${index}`);
    if (!fs.existsSync(streamPath)) {
      break;
    }
    streams.push(fs.readFileSync(streamPath));
  }

  return streams;
}

function loadE2eFixtures() {
  const baseNames = getFixtureBaseNames();
  const fixtures = [];

  for (const baseName of baseNames) {
    let template = '';
    try {
      template = fs.readFileSync(path.join(E2E_DIR, `${baseName}.httpt`), 'utf8');
    } catch (e) {
      // default to ''
    }

    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(path.join(E2E_DIR, `${baseName}.data.json`), 'utf8'));
    } catch (e) {
      // default to {}
    }

    let ir = null;
    let irFile = `${baseName}.httpt-ir`;
    try {
      ir = JSON.parse(fs.readFileSync(path.join(E2E_DIR, irFile), 'utf8'));
    } catch (e) {
      irFile = null;
    }

    let resolved = null;
    try {
      resolved = fs.readFileSync(path.join(E2E_DIR, `${baseName}.httpt-r`), 'utf8');
    } catch (e) {
      // default to null
    }

    let map = null;
    try {
      map = JSON.parse(fs.readFileSync(path.join(E2E_DIR, `${baseName}.httpt-map`), 'utf8'));
    } catch (e) {
      // default to null
    }

    let error = null;
    try {
      error = JSON.parse(fs.readFileSync(path.join(E2E_DIR, `${baseName}.error.json`), 'utf8'));
    } catch (e) {
      // default to null
    }

    let streamContent = null;
    let streamFilePath = null;
    const dataFile = `${baseName}.data.json`;
    const dataStreams = loadReferencedStreams(dataFile);

    if (ir && ir.body && ir.body.type === 'provided') {
      const streamIndex = ir.body.content !== undefined ? ir.body.content : 0;
      const streamFileName = `${irFile}-provided-stream-${streamIndex}`;
      const potentialStreamPath = path.join(E2E_DIR, streamFileName);

      if (fs.existsSync(potentialStreamPath)) {
        streamContent = fs.readFileSync(potentialStreamPath, 'utf8');
        streamFilePath = potentialStreamPath;
      }
    }

    fixtures.push({
      baseName,
      irFile,
      ir,
      resolved,
      map,
      error,
      streamContent,
      streamFilePath,
      dataStreams,
      template,
      data,
    });
  }

  return fixtures;
}

function normalizeForEchoServer(expectedIR, serverIR, adapterName) {
  if (expectedIR.headers) {
    expectedIR.headers = expectedIR.headers.map(h => ({ name: h.name.toLowerCase(), value: h.value }));
    expectedIR.headers = expectedIR.headers.filter(h => !IGNORED_HEADERS.includes(h.name));
  }

  if (serverIR.headers) {
    serverIR.headers = serverIR.headers.map(h => ({ name: h.name.toLowerCase(), value: h.value }));
  }

  if (adapterName === 'fetch' && expectedIR.headers && serverIR.headers) {
    const mergedHeaders = {};
    for (const h of expectedIR.headers) {
      if (mergedHeaders[h.name]) {
        mergedHeaders[h.name] += ', ' + h.value;
      } else {
        mergedHeaders[h.name] = h.value;
      }
    }
    expectedIR.headers = Object.keys(mergedHeaders).map(name => ({ name, value: mergedHeaders[name] }));
  }

  if (adapterName === 'fetch' && ['GET', 'HEAD'].includes(expectedIR.method)) {
    delete expectedIR.body;
  }
}

module.exports = { E2E_DIR, createEchoServer, binarizeIr, loadE2eFixtures, normalizeForEchoServer, getFixtureBaseNames, loadReferencedStreams };
