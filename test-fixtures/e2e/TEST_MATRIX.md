# E2E Test Matrix & Roadmap

This ledger maps our test fixtures to the 7 testing dimensions defined in the `README.md`. It serves as the roadmap for achieving 100% specification coverage.

| Fixture ID | Target Dimension | Description | Status |
| :--- | :--- | :--- | :--- |
| `001-simple-get` | 5. Source Mapping | Basic GET with URL and header injection. | ✅ Implemented |
| `002-post-json` | 4. JSON Nuances | Complex JSON payload with nested structures. | ✅ Implemented |
| `003-post-text-explicit` | 1. Body Type | Explicit `:httpt-body-type: text`. | ✅ Implemented |
| `004-post-json-native` | 1. Body Type | Explicit `:httpt-body-type: json` parsing. | ✅ Implemented |
| `005-post-base64` | 1. Body Type | Explicit `:httpt-body-type: base64` decoding. | ✅ Implemented |
| `006-post-provided` | 1. Body Type | Explicit `:httpt-body-type: provided` streaming. | ✅ Implemented |
| `007-conflict-provided-body` | 1. Body Type | Verifying shadowed body text is ignored. | ✅ Implemented |
| `008-boundary-unix-lf` | 2. Boundary | Parsing with `\n\n` instead of CRLF. | ✅ Implemented |
| **Phase 1: Dynamic Injection & Identity** | | | |
| `009-dynamic-headers` | 7. Dynamic Injection | Injecting `data.headers` before the boundary. | 🚧 Planned |
| `010-dynamic-body` | 7. Dynamic Injection | Injecting `data.body` stream and pseudo-header. | 🚧 Planned |
| `011-identity-template` | 7. Dynamic Injection | 2-line template parsing a full IR context. | 🚧 Planned |
| `012-error-body-conflict` | 7. Dynamic Injection | `BodyConflictError` when template has a body. | 🚧 Planned |
| **Phase 2: Boundaries & Header Edge Cases** | | | |
| `013-minimalist-boundary` | 2. Boundary | Request line immediately followed by double-newline. | 🚧 Planned |
| `014-body-junk` | 2. Boundary | Body containing its own double-newlines. | 🚧 Planned |
| `015-multi-headers` | 3. Header Hygiene | Preserving duplicate headers (e.g., `Set-Cookie`). | 🚧 Planned |
| `016-empty-header` | 3. Header Hygiene | Headers with keys but no values. | 🚧 Planned |
| **Phase 3: Protocol & JSON Quirks** | | | |
| `017-http-2-protocol` | 6. Protocol Edge Cases | Request line parsing with `HTTP/2`. | 🚧 Planned |
| `018-bizarre-spacing` | 6. Protocol Edge Cases | Handling extra spaces in the request line. | 🚧 Planned |
| `019-absolute-uri` | 6. Protocol Edge Cases | Handling absolute URIs in the request line. | 🚧 Planned |
| `020-malformed-json` | 4. JSON Nuances | Fallback/error handling for invalid JSON bodies. | 🚧 Planned |
