/**
 * @typedef {import('./types').HttptIR} HttptIR
 */

/**
 * Executes an httpt IR via the native fetch API.
 * @param {HttptIR} ir
 * @param {string} scheme - e.g., "https", "http"
 * @param {ReadableStream | null} [bodyStream=null]
 * @returns {Promise<Response>}
 */
async function executeFetch(ir, scheme, bodyStream = null) {
  const url = new URL(ir.uri, `${scheme}://${ir.host}`).toString();
  const headers = new Headers();
  for (const { name, value } of ir.headers) headers.append(name, value);

  const requestInit = { method: ir.method, headers };

  if (ir.body && !['GET', 'HEAD'].includes(ir.method)) {
    let requestBody;
    switch (ir.body.type) {
      case 'text': requestBody = ir.body.content; break;
      case 'json': requestBody = JSON.stringify(ir.body.content); break;
      case 'base64': requestBody = Buffer.from(ir.body.content, 'base64'); break;
      case 'provided': requestBody = bodyStream; break;
      default: throw new Error(`Unsupported httpt-ir body type: ${ir.body.type}`);
    }
    requestInit.body = requestBody;
    if (ir.body.type === 'provided') {
      requestInit.duplex = 'half'; // Required for Node.js fetch streams
    }
  } else if (bodyStream) {
    await bodyStream.cancel();
  }
  return fetch(url, requestInit);
}

module.exports = { executeFetch };
