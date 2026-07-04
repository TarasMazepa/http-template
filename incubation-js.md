# JavaScript SDK Architecture & Design

This document captures the formal architectural decisions and API designs specific to the JavaScript SDK implementation of HTTP Template.

# 1. True O(1) Memory Hydration & Streaming

* **Chunk-Based State Machine**
  * We are moving away from string-indexed parsing (`String(template)`) which pulls the entire payload into memory. The `hydrate` function must be implemented as a single-pass, chunk-safe state machine. It needs to handle boundary splits (e.g., holding back an ambiguous `{` at the end of a chunk) to ensure multi-byte characters and template tags are not corrupted across stream chunks.
* **Polymorphic Inputs**
  * To support Node.js, Deno, and the Browser, the `template` input must support polymorphic types: `String` (for in-memory DX), `ReadableStream` (the Web standard), and `AsyncIterable` (for universal compatibility).
* **Triple Stream Output (The Plain Object Signature)**
  * `resolvedStream`: A `ReadableStream<string>` yielding safely decoded text chunks.
  * `mapStream`: A `ReadableStream<Object>` yielding the Index Shift Map JS objects (with `hydrated-start`, `original-start`, etc.).
  * `bodyStream`: A `ReadableStream<Uint8Array>` yielding raw binary byte chunks for the network handoff.
* **Synchronous Stream Composition & Detached Processing**
  * **Synchronous Return (Early Return):** The core `hydrate` function must be entirely synchronous (i.e., drop the `async` keyword from the main signature). It must immediately instantiate the `ReadableStream` objects and return the `{ resolvedStream, mapStream, bodyStream }` object before any data is actually read. This is the gold standard for stream pipelines, allowing downstream consumers to synchronously wire up their entire pipeline (e.g., `.pipeTo()`) in a single execution tick without blocking `await` calls.
  * **Detached Background Worker:** The actual stream consumption, chunk processing, and state machine logic must be pushed into a detached, background asynchronous function. This function is invoked by the main `hydrate` function but **never awaited**.
  * **Fail-Fast Error Propagation:** Because the background worker is detached, any unhandled rejections would normally be swallowed or crash the process. The worker must wrap its logic in a `try/catch` (or append `.catch()`) so that if the source stream fails, or a template syntax error occurs, it instantly propagates the error down the pipes using `resolvedController.error(err)` and `mapController.error(err)`. This safely and immediately aborts any downstream readers.

## 1.1 Implementation Blueprint

```javascript
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
