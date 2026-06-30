const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { dispatchFetch } = require('@httpt/core');

/**
 * @typedef {import('@httpt/core/src/types').HttptIR} HttptIR
 */

/**
 * Dispatches an httpt IR via curl.
 * @param {HttptIR} ir
 * @param {string} scheme - e.g., "https", "http"
 * @param {import('node:stream').Readable | ReadableStream | null} [bodyStream=null]
 * @returns {Promise<void>}
 */
function dispatchCurl(ir, scheme, bodyStream = null) {
  return new Promise((resolve, reject) => {
    const url = `${scheme}://${ir.host}${ir.uri}`;
    const args = ['-s', '-v', '-X', ir.method];

    if (ir.version === 'HTTP/1.0') args.push('--http1.0');
    else if (ir.version === 'HTTP/1.1') args.push('--http1.1');
    else if (ir.version === 'HTTP/2' || ir.version === 'HTTP/2.0') args.push('--http2');
    else if (ir.version === 'HTTP/3') args.push('--http3');

    for (const { name, value } of ir.headers) {
      args.push('-H', value ? `${name}: ${value}` : `${name};`);
    }

    let buffer = null;
    let hasBodyData = false;

    if (ir.body) {
      hasBodyData = true;
      if (ir.body.type === 'text') {
        buffer = Buffer.from(ir.body.content, 'utf-8');
      } else if (ir.body.type === 'json') {
        buffer = Buffer.from(JSON.stringify(ir.body.content), 'utf-8');
      } else if (ir.body.type === 'base64') {
        buffer = Buffer.from(ir.body.content, 'base64');
      } else if (ir.body.type !== 'provided') {
        throw new Error(`Unsupported httpt-ir body type: ${ir.body.type}`);
      }
      args.push('--data-binary', '@-');
    }
    args.push(url);

    const curlProc = spawn('curl', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    curlProc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`curl process exited with code ${code}`));
      }
    });
    curlProc.on('error', reject);

    if (hasBodyData) {
      if (buffer) {
        curlProc.stdin.end(buffer);
        if (bodyStream) {
          if (typeof bodyStream.cancel === 'function') {
            bodyStream.cancel(); // Web Stream
          } else if (typeof bodyStream.destroy === 'function') {
            bodyStream.destroy(); // Node Stream
          }
        }
      } else if (bodyStream) {
        if (typeof bodyStream.cancel === 'function') {
          // Web stream
          Readable.fromWeb(bodyStream).pipe(curlProc.stdin);
        } else {
          // Node stream
          bodyStream.pipe(curlProc.stdin);
        }
      } else {
        curlProc.stdin.end();
      }
    } else {
      curlProc.stdin.end();
      if (bodyStream) {
        if (typeof bodyStream.cancel === 'function') {
          bodyStream.cancel(); // Web Stream
        } else if (typeof bodyStream.destroy === 'function') {
          bodyStream.destroy(); // Node Stream
        }
      }
    }
  });
}

async function emitCommand(file, flags) {
  if (!file) {
    throw new Error('Missing .httpt-ir file');
  }

  const ir = JSON.parse(require('node:fs').readFileSync(file, 'utf-8'));
  const scheme = flags.scheme || 'https';
  const target = flags.target || 'fetch';

  if (flags['dry-run'] || flags.dryRun) {
    console.log(JSON.stringify(ir, null, 2));
    return;
  }

  if (target === 'curl') {
    await dispatchCurl(ir, scheme);
    return;
  }

  if (target === 'fetch') {
    const response = await dispatchFetch(ir, scheme);
    const responseText = await response.text();
    process.stdout.write(responseText);
    return;
  }

  throw new Error(`Unsupported emit target: ${target}`);
}

emitCommand.dispatchCurl = dispatchCurl;

module.exports = emitCommand;
