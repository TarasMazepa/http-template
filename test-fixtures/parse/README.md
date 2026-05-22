# Parser Test Fixtures

This directory contains the test vectors for the **Parse & Verify Stage** of the [HTTP Template](../../incubation.md) processing workflow.

The parser's primary job is to split a hydrated `.httpt-r` string into a structured Intermediate Representation (`.httpt-ir`), handling pseudo-header extraction and O(1) body handoffs.

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

## File Structure

Every test case consists of a pair of files:

1. **`###-name.httpt-r`**: The hydrated input string (The "Resolved" template).
2. **`###-name.httpt-ir`**: The expected JSON Intermediate Representation.
