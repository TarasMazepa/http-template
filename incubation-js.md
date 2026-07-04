# JavaScript SDK Architecture & Design

This document captures the formal architectural decisions and API designs specific to the JavaScript SDK implementation of HTTP Template.

# 1. True O(1) Memory Hydration & Streaming

* **Chunk-Based State Machine**
  * We are moving away from string-indexed parsing (`String(template)`) which pulls the entire payload into memory. The `hydrate` function must be implemented as a single-pass, chunk-safe state machine. It needs to handle boundary splits (e.g., holding back an ambiguous `{` at the end of a chunk) to ensure multi-byte characters and template tags are not corrupted across stream chunks.
* **Polymorphic Inputs**
  * To support Node.js, Deno, and the Browser, the `template` input must support polymorphic types: `String` (for in-memory DX), `ReadableStream` (the Web standard), and `AsyncIterable` (for universal compatibility).
* **Dual Stream Output (The Plain Object Signature)**
  * To output both the resolved text and the source map without breaking the single-pass rule, the `hydrate` function will return a structured plain object: `{ resolvedStream, mapStream, bodyStream }`.
  * `resolvedStream` is a `ReadableStream` yielding `String` chunks.
  * `mapStream` is a `ReadableStream` yielding JS objects (the Index Shift Map with `hydrated-start`, `original-start`, etc.).
  * This avoids anti-patterns like attaching custom subfields to a single stream object and makes downstream consumer routing trivial via destructuring.
