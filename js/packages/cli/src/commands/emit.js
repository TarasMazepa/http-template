const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { executeWithFetch } = require('@httpt/core');

/**
 * @typedef {import('@httpt/core/src/types').HttptIR} HttptIR
 */

function executeWithCurl(ir, bodyStream, scheme) {
  return new Promise((resolve, reject) => {
    const url = `${scheme}://${ir.host}${ir.uri}`;
    const args = ['-s', '-v', '-X', ir.method];

    if (ir.version === 'HTTP/1.0') args.push('--http1.0');
    else if (ir.version === 'HTTP/1.1') args.push('--http1.1');
    else if (ir.version === 'HTTP/2' || ir.version === 'HTTP/2.0') args.push('--http2');
    else if (ir.version === 'HTTP/3') args.push('--http3');

    for (const { name, value } of ir.headers) {
      args.push('-H', `${name}: ${value}`);
    }

    if (bodyStream && !['GET', 'HEAD'].includes(ir.method)) {
      args.push('--data-binary', '@-');
    }
    args.push(url);

    const curlProc = spawn('curl', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    curlProc.on('close', resolve);
    curlProc.on('error', reject);

    if (bodyStream && !['GET', 'HEAD'].includes(ir.method)) {
      Readable.fromWeb(bodyStream).pipe(curlProc.stdin);
    } else {
      curlProc.stdin.end();
      if (bodyStream) bodyStream.cancel();
    }
  });
}

function emitCommand(file, flags) {
  // TODO: Read parsed IR, handle the --target <curl|fetch> flag, and call the respective executor.
  console.log(`[emit] Executing on file: ${file} with flags: ${JSON.stringify(flags)}`);
}
module.exports = { emitCommand, executeWithCurl };
