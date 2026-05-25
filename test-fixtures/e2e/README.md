# End-to-End (E2E) Test Fixtures

## Document Intent

This document serves two purposes. The first half (**The Testing Matrix**) describes the dimensions and edge-cases that these test vectors evaluate. The second half (**Test Runner Specification**) defines the strict, technical contract for how any test runner must load, hydrate, and validate these files.

This directory contains the test vectors for the **Parse Stage** of the [HTTP Template](../../incubation.md) processing workflow.

## Multistep Verification
These fixtures are designed for granular or full-lifecycle testing:
1. **Hydration Stage:** Verify that `.httpt` + `.data.json` produces `.httpt-r` and the `.httpt-map`. This stage must now also evaluate error-throwing scenarios (like `BodyConflictError`) when strict data contracts are violated.
2. **Parse Stage:** Verify that `.httpt-r` deconstructs into the `.httpt-ir`.
3. **Mapping Integrity:** Verify that a character index in `.httpt-r` can be accurately mapped back to the `.httpt` source using the `.httpt-map`.

The parser's primary job is to deconstruct a hydrated `.httpt-r` string into a structured Intermediate Representation (`.httpt-ir`), handling pseudo-header extraction and O(1) body handoffs.

## The Testing Matrix

To ensure the parser is robust, fixtures are designed across six distinct dimensions. Each test case should be named using the `###-description` pattern.

### 1. Body Type Logic

Tests the interaction between the `:httpt-body-type` pseudo-header and the actual content.

| Situation | `:httpt-body-type:` | Content | Expected IR Result |
| --- | --- | --- | --- |
| **Default** | (Missing) | String | `type: "text"` |
| **Explicit Text** | `text` | String | `type: "text"` |
| **JSON Object** | `json` | `{"a":1}` | `type: "json"`, content is native object |
| **Base64 Binary** | `base64` | `SGVsbG8=` | `type: "base64"` |
| **Out-of-band** | `provided` | (Empty) | `type: "provided"`, `content` omitted |
| **Conflict/Shadow** | `provided` | "Shadow" | `type: "provided"`, content is ignored |

### 2. The Boundary Dimension

The parser must strictly split at the *first* occurrence of a double-newline.

* **Standard:** `\r\n\r\n` (CRLF).
* **Unix-style:** `\n\n` (LF).
* **Minimalist:** Request line immediately followed by double-newline (no headers).
* **Body Junk:** Body containing its own double-newlines (must not trigger a second split).

### 3. Header & Pseudo-Header Hygiene

* **Artifact Stripping:** The `:httpt-body-type` header must be consumed and removed from the IR `headers` array.
* **Normalization:** Pseudo-headers recognized case-insensitively (e.g., `:HTTPT-BODY-TYPE`).
* **Multi-headers:** Preserve duplicate standard headers (like `Set-Cookie`) as an ordered list.
* **Empty Values:** Headers with keys but no values (e.g., `X-Empty:`).

### 4. JSON Content Nuances

* **Native Object:** Verify the IR `content` holds a real JSON object/array, not a string.
* **Malformed JSON:** Verify the parser handles invalid JSON gracefully (e.g., fallback to `text` or explicit error).

### 5. Source Mapping (Index Shift Map)

* **Expansion:** `{{ a }}` (6 chars) $\rightarrow$ `long-value` (10 chars).
* **Contraction:** `{{ long-name }}` (13 chars) $\rightarrow$ `1` (1 char).
* **Multi-line:** Variables resolving to strings containing newlines.

### 6. Protocol & Request-Line Edge Cases

* **HTTP Versions:** Validating `HTTP/1.1`, `HTTP/1.0`, and `HTTP/2.0` (as a string).
* **Spacing:** Handling extra spaces between Method, URI, and Version.
* **Special URIs:** Absolute URIs in the request line vs. relative paths.

## 7. Dynamic Injection & Hydration Mechanics

* **Dynamic Headers:** Verify that an array provided in `data.headers` is automatically injected into the HTTP Head, correctly formatted, and placed exactly before the first double-newline boundary.
* **Dynamic Body:** Verify that a StreamDefinition provided in `data.body` automatically injects the `:httpt-body-type:` pseudo-header into the Head and appends the body content after the double-newline boundary.
* **Strict Collision (BodyConflictError):** Verify that if `data.body` is provided, and the source `.httpt` template contains any non-whitespace characters after its double-newline boundary, the hydrator immediately throws a `BodyConflictError`.
* **The Identity Template:** Verify that hydrating the minimal Canonical Identity Template (`{{ method | raw }} {{ uri | raw }}...`) with a full `.httpt-ir` JSON context perfectly reconstructs the original request seamlessly.

## Test Runner Specification

### File Specification

A complete test case consists of six files:
* `*.httpt` : Source template.
* `*.data.json` : Pure configuration variables (strictly no stream references).
* `[exact-referencing-filename]-provided-stream-[index]` : Stream file containing raw binary or text data, strictly with NO file extensions. The integer `[index]` in the filename directly correlates to the integer `content` index in the `StreamDefinition`. For example, if a stream is referenced in `006-post-provided.httpt-ir`, the stream file MUST be named `006-post-provided.httpt-ir-provided-stream-0`. If it is referenced in `004.data.json`, it MUST be named `004.data.json-provided-stream-0`.
* `*.httpt-r` : The hydrated request (resolved).
* `*.httpt-ir` : Expected Intermediate Representation (IR).
* `*.httpt-map` : Index Shift Map.

### Workflow & Hydration Signature

* The testing workflow uses the mandatory hydration signature: `hydrate(template, data, nativeStreamsArray)`.
* The test runner must look for streams bound explicitly to the file it is currently processing (e.g., loading `data.json` streams for `hydrate()`, and `httpt-ir` streams for `execute()`). It MUST sequentially attempt to read the stream files using the new naming convention (e.g. `[exact-referencing-filename]-provided-stream-0`). For each found file, it loads it into memory as a **native I/O object** (e.g., `Buffer` or `ReadableStream`), and passes the resulting array as the third argument: `hydrate(template, data, nativeStreamsArray)`.

### Master Specification Rules (Hardened Logic)

* **Stream Reference Validation:**
  * Implicit default (index 0) is permitted ONLY if exactly one stream is present.
  * Ambiguity Error: If >1 `provided` stream is referenced, all must explicitly define a `content` index.
  * Uniqueness Error: Every stream reference index MUST be unique; duplicates trigger a validation error.
* **Stream Orchestration:**
  * **Materialization (Metadata):** Streams used in Headers/Request-Line are buffered to memory during hydration. If a stream is too large, throw an error.
  * **Concatenation (Body):** Streams used in the Body are piped via streaming pipeline (O(1) memory).
