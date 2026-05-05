/**
 * @typedef {import('./types').HttptIR} HttptIR
 */

/**
 * Executes an httpt IR via the native fetch API.
 * @param {HttptIR} ir
 * @param {ReadableStream | null} bodyStream
 * @param {string} scheme - e.g., "https", "http"
 * @returns {Promise<Response>}
 */
async function executeWithFetch(ir, bodyStream, scheme) {
  const url = new URL(ir.uri, `${scheme}://${ir.host}`).toString();
  const headers = new Headers();
  for (const { name, value } of ir.headers) headers.append(name, value);

  const requestInit = { method: ir.method, headers };

  if (bodyStream && !['GET', 'HEAD'].includes(ir.method)) {
    requestInit.body = bodyStream;
    requestInit.duplex = 'half'; // Required for Node.js fetch streams
  } else if (bodyStream) {
    await bodyStream.cancel();
  }
  return fetch(url, requestInit);
}

module.exports = { executeWithFetch };
