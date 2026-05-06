/**
 * @typedef {Object} HttpHeader
 * @property {string} name
 * @property {string} value
 */

/**
 * @typedef {Object} HttptIR
 * @property {string} schema-version - e.g., "1.0"
 * @property {string} method         - e.g., "GET", "POST", "PUT"
 * @property {string} host           - e.g., "api.example.com"
 * @property {string} uri            - e.g., "/api/v1/search?q=term"
 * @property {string} version        - e.g., "HTTP/1.1", "HTTP/2"
 * @property {HttpHeader[]} headers  - The remaining headers
 */

module.exports = {};
