/**
 * @typedef {Object} HttpHeader
 * @property {string} name
 * @property {string} value
 */

/**
 * @typedef {Object} HttptBody
 * @property {"text"|"base64"|"json"|"provided"} type
 * @property {any} [content] - The payload data (String for "text" and "base64", Object/Array for "json", omitted for "provided")
 */

/**
 * @typedef {Object} HttptIR
 * @property {string} schema-version - e.g., "1.0"
 * @property {string} method         - e.g., "GET", "POST", "PUT"
 * @property {string} host           - e.g., "api.example.com"
 * @property {string} uri            - e.g., "/api/v1/search?q=term"
 * @property {string} version        - e.g., "HTTP/1.1", "HTTP/2"
 * @property {HttpHeader[]} headers  - The remaining headers
 * @property {HttptBody} [body]      - The optional request payload
 */

/**
 * @typedef {ReadableStream | import('node:stream').Readable | Buffer | Blob | File} NativeStream
 */

/**
 * @typedef {string | NativeStream} Resolvable
 */

module.exports = {};
