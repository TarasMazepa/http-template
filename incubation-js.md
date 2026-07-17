# JavaScript SDK Architecture & Design

This document captures the formal architectural decisions and API designs specific to the JavaScript SDK implementation of HTTP Template.

# 1. True O(1) Memory Hydration & Streaming

* **Chunk-Based State Machine**
  * We are moving away from string-indexed parsing which pulls the entire payload into memory. The `hydrate` function must be implemented as a single-pass, chunk-safe state machine. It needs to handle boundary splits (e.g., holding back an ambiguous `{` at the end of a chunk) to ensure multi-byte characters and template tags are not corrupted across stream chunks.
* **Polymorphic Inputs**
  * To support Node.js, Deno, and the Browser, the `template` input must support polymorphic types: `String` (for in-memory DX), `ReadableStream` (the Web standard), and `AsyncIterable` (for universal compatibility).
* **Triple Stream Output (The Plain Object Signature)**
  * To output both the resolved text and the source map without breaking the single-pass rule, the `hydrate` function will return a structured plain object: `{ resolvedStream, mapStream, bodyStream }`.
  * `resolvedStream`: A `ReadableStream<string>` yielding safely decoded text chunks.
  * `mapStream`: A `ReadableStream<Object>` yielding the Index Shift Map JS objects (with `hydrated-start`, `original-start`, etc.).
  * `bodyStream`: A `ReadableStream<Uint8Array>` yielding raw binary byte chunks for the network handoff.
  * This avoids anti-patterns like attaching custom subfields to a single stream object and makes downstream consumer routing trivial via destructuring.
* **Synchronous Stream Composition & Detached Processing**
  * **Synchronous Return (Early Return):** The core `hydrate` function must be entirely synchronous (i.e., drop the `async` keyword from the main signature). It must immediately instantiate the `ReadableStream` objects and return the `{ resolvedStream, mapStream, bodyStream }` object before any data is actually read. This is the gold standard for stream pipelines, allowing downstream consumers to synchronously wire up their entire pipeline (e.g., `.pipeTo()`) in a single execution tick without blocking `await` calls.
  * **Detached Background Worker:** The actual stream consumption, chunk processing, and state machine logic must be pushed into a detached, background asynchronous function. This function is invoked by the main `hydrate` function but **never awaited**.
  * **Fail-Fast Error Propagation:** Because the background worker is detached, any unhandled rejections would normally be swallowed or crash the process. The worker must wrap its logic in a `try/catch` (or append `.catch()`) so that if the source stream fails, or a template syntax error occurs, it instantly propagates the error down the pipes using `resolvedController.error(err)` and `mapController.error(err)`. This safely and immediately aborts any downstream readers.

## 1.1 Implementation Blueprint

```javascript
/**
 * @param {ReadableStream<Uint8Array | string>} templateStream
 * @param {Object} [data={}]
 * @param {Array<ReadableStream<Uint8Array> | Blob | any>} [streams=[]]
 * @returns {{
 * resolvedStream: ReadableStream<string>,
 * mapStream: ReadableStream<object>,
 * bodyStream: ReadableStream<Uint8Array>
 * }}
 */
export function hydrate(templateStream, data = {}, streams = []) {
  let resolvedController, mapController, bodyController;

  // 1. Synchronous Stream Composition
  const resolvedStream = new ReadableStream({
    start(c) { resolvedController = c; }
  });
  const mapStream = new ReadableStream({
    start(c) { mapController = c; }
  });
  const bodyStream = new ReadableStream({
    start(c) { bodyController = c; }
  });

  // 2. Detached Background Processing (Never awaited)
  // The worker acts as a router. It pipes data to resolvedController
  // until the \n\n boundary is crossed, then routes to bodyController.
  processStreamBackground(templateStream, data, streams, {
    resolved: resolvedController,
    map: mapController,
    body: bodyController
  }).catch(err => {
    // 3. Fail-Fast Error Propagation
    resolvedController.error(err);
    mapController.error(err);
    bodyController.error(err);
  });

  // Early Return
  /**
   * @type {{
   * resolvedStream: ReadableStream<string>,
   * mapStream: ReadableStream<object>,
   * bodyStream: ReadableStream<Uint8Array>
   * }}
   */
  return {
    resolvedStream,
    mapStream,
    bodyStream
  };
}

async function processStreamBackground(templateStream, data, streams, controllers) {
  const reader = templateStream.getReader();
  let isBodyPhase = false;

  // The single-pass state machine lives here.
  // It decodes Uint8Array chunks, evaluates tags like {{ stream-as-is }},
  // and tracks the \n\n boundary.
  // - IF !isBodyPhase: enqueue to controllers.resolved
  // - IF isBodyPhase: enqueue to controllers.body
}
```

# 2. JavaScript Stream Alternatives & Optimization

To achieve maximum efficiency and maintain an O(1) memory footprint, the HTTP Template JavaScript SDK employs a hybrid streaming strategy. It leverages both `AsyncIterable` (Async Generators) and the Web Streams API (`ReadableStream`) depending on the specific performance requirements of the data being routed.

## 2.1 The Hybrid Stream Strategy

When outputting the triple stream signature `({ resolvedStream, mapStream, bodyStream })`, the engine mixes stream types to balance raw CPU speed with safe memory management:

*   **`resolvedStream` (Headers & Request Line):** Uses `AsyncIterable<string>` (`async function*`).
    *   *Reasoning:* Async generators are native language features with exceptionally low CPU overhead. They can process and yield text chunks significantly faster than Web Streams because they avoid the heavy locking, promise allocation, and queue management required by the Web Streams API.
*   **`mapStream` (Index Shift Map):** Uses `AsyncIterable<object>` (`async function*`).
    *   *Reasoning:* Yielding plain JavaScript objects through a native generator acts as a high-performance memory reference pipeline. This allows the downstream consumer to process the Index Shift Map almost instantaneously without the overhead of enqueueing objects into a Web Stream.
*   **`bodyStream` (Payload):** Uses `ReadableStream<Uint8Array>`.
    *   *Reasoning:* For raw binary data and network I/O, `ReadableStream` is mandatory. It natively handles backpressure and supports BYOB (Bring Your Own Buffer) for zero-copy reads. This is critical for preventing memory bloat and garbage collection pauses when piping massive payloads (like file uploads) to execution clients like `fetch`.

## 2.2 Internal Consumption (The `parse` Stage)

By utilizing this hybrid interface internally, the downstream `parse` function benefits from maximum CPU speed for text/objects and maximum memory safety for binary data.

The parser can consume the headers blazingly fast using a standard `for await...of` loop, while seamlessly handing off the unread `ReadableStream` body to the execution network layer:

```javascript
export async function parse(resolvedIterable, optionalBodyStream) {
  let headString = "";

  // High-performance consumption of the resolved headers
  for await (const chunk of resolvedIterable) {
    headString += chunk;
    // ... logic to detect the \n\n boundary ...
  }

  // Parse the head, construct the IR, and pass the bodyStream through
}
```

## 2.3 Public API Unification

While the internal pipeline uses a hybrid model for raw performance, if these streams must be exposed to public SDK consumers who expect a strictly unified API, the high-performance async iterables can be effortlessly wrapped into standard Web Streams with zero dependencies:

```javascript
return {
  resolvedStream: ReadableStream.from(generateResolvedText()),
  mapStream: ReadableStream.from(generateMapObjects()),
  bodyStream: getBinaryBodyStream() // Already a ReadableStream
};
```
