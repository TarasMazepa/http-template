# 1. HTTP Template Core Specification

## 1.1 Introduction & Philosophy

**HTTP Template** is a templating tool for defining HTTP requests using a syntax that resolves into raw HTTP format (RFC 9110/9112).

At its core, it performs string replacement on raw HTTP text. To handle the data formatting required for valid HTTP requests, it provides a set of explicit functions to encode parameters (e.g., JSON escaping, URL encoding, or binary file streaming).

The tool consumes a template, hydrates it using the explicit signature `hydrate(template, data, streams = [])`, and outputs a structured JSON Intermediate Representation (`.httpt-ir`). The `streams` argument is an array of **native I/O objects** (e.g., `ReadableStream`, `Buffer`, `Blob`, or `File` handles, depending on the SDK environment) passed as a third argument, separate from the `data` context. The `data.json` context must now only contain pure configuration variables. This IR can then be used by various execution clients to perform the actual network request.

This document serves as the technical specification for the templating syntax, the parsing workflow, and the IR schema.

### 1.1.1 The Format of .httpt

At its core, the structure of an `.httpt` file is **modeled after** the standard HTTP message format (RFC 9110/9112). While the source template (`.httpt`) may contain placeholders that do not conform to HTTP syntax, the *hydrated result* (`.httpt-r`) must structurally represent a valid HTTP request. The file is always divided into three distinct parts:

1. **The Request Line:** Defines the method, the target URI (which can be templated), and the HTTP version.
2. **The Headers:** A list of key-value pairs.
3. **The Body (Optional):** Separated from the headers by a mandatory blank line.

### 1.1.2 Anatomy of the Template

```http
[METHOD] [PATH_AND_QUERY] [HTTP_VERSION]
[Header-Name]: [Header-Value]
[Header-Name]: [Header-Value]

[Optional Body]
```

## 1.2 The Parsing & Execution Workflow

The execution of an .httpt file consists of three stages: Hydrate, Parse, and Execute.

* **Hydrate Stage Mechanism (Single-Pass State Machine)** / Implements / hydration as a single-pass streaming state machine rather than relying on heavy regex engines or intermediate ASTs.
  * **Input:** Consumes either a file stream or an in-memory string, reading it character-by-character.
  * **Output:** Writes in-place, outputting either directly to a hydrated `.httpt-r` file ("Resolved") or streaming directly into the downstream parser.
  * **Performance:** Achieves O(1) memory overhead since it does not build intermediate data structures for the template logic.
  * **Source Mapping:** The Index Shift Map is generated effortlessly on the fly during this single pass by tracking the integer differences between a `read-cursor` and a `write-cursor` whenever a `{{ parameter | function-name }}` tag is resolved.
* **Parse Stage Mechanism (Parser)** / Deconstructs / the hydrated `.httpt-r` string or stream using a fast parser designed for a strict subset of HTTP.
  * **Separation of Head and Body:** The parser scans the hydrated string or stream strictly for the first double newline (`\r\n\r\n` or `\n\n`). Everything before is the Head; everything after is the Body. *(See Design Note: Line Endings in Section VII for rationale).*
  * **Head Parsing:** The Request Line and Headers are parsed using fast, string splitting. The Request Line is split by spaces, and headers are split by the first colon (`:`).
  * **O(1) Body Handoff:** The parser stops reading exactly at the double newline boundary. The unread remainder of the stream (the Body) is handed off directly to the downstream execution client without being buffered or mapped into memory.
  * **Error Handling:** Syntax errors (like malformed headers) caught during this string splitting must still query the **Index Shift Map** to point the error back to the exact character index in the user's original `.httpt` file.
* **Execute Stage Mechanism** / Hands off / the fully resolved request to the execution client (e.g., `fetch`, `curl`) if the parsed request is valid.

## 1.3 The Source Template

### 1.3.1 Templating Syntax

Templates use a linear processing workflow based on data injection and transformations. The basic syntax is:
`{{ parameter | function-name }}`

To apply multiple transformations, chain them using the pipe operator (`|`). Functions are processed from left to right:
`{{ parameter | function-one | function-two(arg-one, arg-two) }}`

* Parameters refer to keys in the data context (e.g., `user-id`).
* Functions are specific transformations applied to the data before injection into the HTTP stream.

### 1.3.2 Built-in Escaping Options

#### 1.3.2.1 Core Functions
These handle basic data injection and URL safety.

* **raw Mechanism** / Injects / the variable exactly as provided in the data map with zero escaping or transformation. Mandatory for all direct injections (`{{ host-url | raw }}`).
* **url Mechanism** / Encodes / the value (e.g., space becomes `%20`, `#` becomes `%23`) for safe use in URL paths or query parameters (`{{ path | url }}`).

#### 1.3.2.2 JSON Functions
Designed to allow precise control over JSON structure without breaking syntax. Similar granular patterns (`xml-*`, `yml-*`) will follow in the future.

* **json-value Mechanism** / Serializes / the parameter into its JSON representation (e.g., boolean `true`, list `[1,2]`, object `{"k":"v"}`). If the variable is a string, it includes the surrounding quotes. If it is a boolean or number, it remains unquoted (`{{ obj | json-value }}`).
* **json-string Mechanism** / Escapes / internal characters only (e.g., newlines, tabs, and internal double quotes `"` becomes `\"`). It does not wrap the output in quotes, allowing it to be concatenated inside a larger string (`{{ bio | json-string }}`).
* **json-key Mechanism** / Escapes / a string specifically for use as a JSON property key (`{{ name | json-key }}`).

#### 1.3.2.3 Streaming Transformations
These functions are 'Streaming Transformations' that operate on the `StreamDefinition` context. They instruct the execution engine how to resolve a stream into a payload.

* **stream-as-base64 Mechanism** / Encodes / the binary content of a stream into a Base64 string, ideal for JSON image uploads (`{{ path | stream-as-base64 }}`).
* **stream-as-utf8 Mechanism** / Reads / a stream and ensures the content is encoded as UTF-8 in the request body. Useful for injecting external text, GraphQL queries, or XML.
* **stream-as-is Mechanism** / Streams / the stream as a raw binary payload, bypassing text encoding. This is used for `multipart/form-data` uploads or binary body transfers.
* **multipart/form-data (Note):** Multipart requests are single HTTP requests. The body is divided into multiple sections, separated by a `boundary` string defined in the `Content-Type` header.

### 1.3.3 Common Cases & Variations

HTTP Template supports common HTTP request patterns through explicit function-based variable substitution.

#### 1.3.3.1 Case 1: GET/DELETE
Standard requests without a body pass dynamic data via query parameters. Use the `{{ parameter | url }}` function to ensure parameters are correctly percent-encoded.

```http
GET /api/v1/search?q={{ search-term | url }}&limit={{ limit-count | raw }} HTTP/1.1
Host: {{ api-host | raw }}
Authorization: Bearer {{ auth-token | raw }}
Accept: application/json

```
*(Note the trailing blank line to indicate the end of the headers, even when there is no body).*

#### 1.3.3.2 Case 2: Structured Payloads (JSON/XML)
To send structured data, define the `Content-Type` header and use `{{ parameter | json-* }}` functions to format the request body. The execution client automatically calculates the `Content-Length`.

```http
POST /v1/webhooks HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "event": "{{ event-name | json-string }}",
  "payload": {{ event-data | json-value }}
}
```

#### 1.3.3.3 Case 3: Form URL-Encoded
For form submissions, set the `Content-Type` to `application/x-www-form-urlencoded` and use `{{ parameter | url }}` for all form field values.

```http
POST /oauth/token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={{ client-id | url }}&client_secret={{ secret-key | url }}
```

#### 1.3.3.4 Case 4: Multipart Form Data
For file uploads, set the `Content-Type` to `multipart/form-data` and include a `boundary` definition. Use `{{ parameter | stream-as-is }}` to inject binary data into specific body parts.

```http
POST /api/uploads HTTP/1.1
Host: api.example.com
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="description"

{{ file-description | raw }}
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="document"; filename="{{ file-name | raw }}"
Content-Type: application/pdf

{{ document-stream | stream-as-is }}
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```

### 1.3.4 Dynamic Header Injection

The Hydration Stage supports dynamic header injection without requiring explicit template placeholders. The `data` context object reserves the `"headers"` keyword for this purpose.

* **Dynamic Header Injection Mechanism** / Injects / a dynamic array of headers into the generated `.httpt-r` output without requiring explicit placeholders.

If provided, the `"headers"` property must be an array of objects exactly matching the IR schema: `[{ "name": "Header-Name", "value": "Header-Value" }]`.

**The Insertion Rule:** These headers MUST be appended to the very bottom of the existing headers block, exactly preceding the mandatory blank line (`\n\n` or `\r\n\r\n`) that separates the HTTP Head from the Body.

#### 1.3.4.1 Example Usage

Given a simple `GET` request:

**Template (`request.httpt`):**
```http
GET /api/data HTTP/1.1
Host: api.example.com
```

**Context Data (`data.json`):**
```json
{
  "headers": [
    { "name": "Authorization", "value": "Bearer token123" },
    { "name": "X-Custom-Tracking", "value": "xyz789" }
  ]
}
```

**Output (`request.httpt-r`):**
```http
GET /api/data HTTP/1.1
Host: api.example.com
Authorization: Bearer token123
X-Custom-Tracking: xyz789

```

### 1.3.5 Dynamic Body Injection

The `"body"` key is a reserved keyword in the `data` context object. It must strictly adhere to the `StreamDefinition` schema (`{ "type": "...", "content": "..." }`).

* **Dynamic Body Injection Mechanism** / Injects / the pseudo-header `:httpt-body-type: ${data.body.type}` into the HTTP Head (using the same lookahead buffer mechanism as dynamic headers) if `data.body` is present, and then appends the body content after the double-newline boundary.
* **Strict Conflict Prevention:** If `data.body` is provided, the source `.httpt` template MUST NOT contain its own body.
* **Implementation Note (O(1) Collision Detection):** To maintain the single-pass memory footprint, the state machine should transition to a 'Body' state after the double-newline. If it reads any non-whitespace character from the source template while in this state AND `data.body` is defined, it must immediately throw a `BodyConflictError` (see Appendix A).

## 1.4 The Intermediate Representation (.httpt-ir)

### 1.4.1 The Intermediate Representation (IR)

Once the Parse Stage **deconstructs** the hydrated `.httpt-r` string, it maps the extracted HTTP components into a strictly defined Intermediate Representation (IR).

To ensure maximum portability across execution environments (Dart, Node.js, CLI) and to enable deterministic unit testing, the IR is defined as a standard JSON structure. This serves as the definitive contract between the *Parse Stage* and the *Execute Stage*.

*(Note: While the Intermediate Representation is structurally a standard JSON object, it is saved to disk using the proprietary `.httpt-ir` extension to maintain the ecosystem namespace and avoid tooling conflicts).*

### 1.4.2 Bridging the Representation Gap

Because the hydrated `.httpt-r` and `.httpt-ir` files are flat text streams, the parser needs a mechanism to determine the body type without content-sniffing. This is handled via the `:httpt-body-type` pseudo-header:

* `:httpt-body-type: provided`: Signals that the body content is handled as an in-memory reference (e.g., stream, Blob, or Buffer). This avoids serialization and disk I/O for large payloads or live streams. The body is omitted from the intermediate file contents.
* `:httpt-body-type: base64`: Signals that the binary data is embedded directly in the intermediate text files as a Base64-encoded string. This ensures the data persists in a text-based format where streaming is not feasible.
* `:httpt-body-type: text` (Default): Signals that the body is a standard UTF-8 string. This is the default if no pseudo-header is present.
- `:httpt-body-type: json`: Signals that the body is a JSON string. The Parse Stage **must** buffer this content and parse it into a native JSON object or array for the IR `content` field. (Note: This is an exception to the O(1) body handoff rule, as the parser must read the full body to perform validation and conversion).

**Implementation Note:** The parser consumes this pseudo-header to set the IR `body.type` and **MUST strictly remove it** from the final header set. It is an internal artifact and is never part of the executed HTTP request.

### 1.4.3 The StreamDefinition Schema

The `StreamDefinition` schema is a unified data contract applied to both the `data.json` context and the Intermediate Representation (the `body` field). It mandates that all binary/payload references consist of:

* `type`: Indicates how the execution client should handle the content (`text` | `base64` | `json` | `provided`).
* `content`: The actual payload data or a reference to it. For `provided` types, `content` explicitly acts as the integer index pointing directly to the native memory object residing at that index in the `streams` array.

### 1.4.4 Stream Reference Validation

When referencing streams within the context, the following validation rules apply:

* **Implicit Default:** If `content` is omitted for a `provided` stream, it defaults to index `0`.
* **Ambiguity Error:** If >1 `provided` stream is referenced in the context, all references MUST explicitly provide a `content` index. Implicit defaults are disallowed.
* **Uniqueness Error:** Every stream reference index MUST be unique. Duplicate indices throw a validation error.

### 1.4.5 Stream Orchestration

The following rules dictate how streams are handled during execution:

* **Materialization (Metadata):** Any stream used in Request-Line or Headers MUST be buffered into memory (materialized) during hydration. If the stream is too large, throw an error.
* **Concatenation (Body):** Any streams used in the Body MUST be concatenated via a streaming pipeline (O(1) memory) and piped directly to the network socket.

### 1.4.6 IR JSON Schema

The JSON object represents the fully resolved request, stripped of all internal parsing artifacts.

* **`schema-version`**: The version of the IR structure (currently `"1.0"`).
* **`host`**: The extracted target host/authority for the request (e.g., `"api.example.internal"`). Note: The Parse Stage should extract the `Host` header (or `:authority` pseudo-header) to populate this root field.
* **`method`**: The HTTP method (e.g., `GET`, `POST`).
* **`uri`**: The exact target path and query string (e.g., `/api/v1/search?q=term`).
* **`version`**: The HTTP protocol version (e.g., `HTTP/1.1`).
* **`headers`**: An array of key-value objects. An array is used instead of a standard JSON dictionary to safely preserve multiple headers with the exact same name without data loss.
* `body` *(Optional)*: An object defining the payload structure using the `StreamDefinition` schema.
  * `type`: Indicates how the execution client should handle the content. Strict allowed values:
    * `"text"`: A standard UTF-8 string payload (used for URL-encoded forms, XML, HTML, or raw strings). The executor sends it exactly as-is.
    * `"base64"`: A Base64 encoded string. The executor must decode this into a raw byte array before sending over the wire.
    * `"json"`: A JSON object or array. The executor natively stringifies this object (e.g., JSON.stringify()) before sending, avoiding the need for double-escaped strings in the IR.
    * `"provided"`: Indicates the payload is provided out-of-band at runtime (e.g., passing a file stream, Blob, or Buffer directly to the execution function).
  * `content`: The actual payload data (String for `text`/`base64`, Object/Array for `json`). When the type is `"provided"`, this explicitly links to a stream index (Integer).

## 1.5 End-to-End Examples


### 1.5.1 Example 1: Complex User Update Request

*This request is hydrated via the `hydrate(template, data, streams = [])` 3-argument signature.*

**`update-user.httpt` (The Template)**
```http
POST /v1/users/update HTTP/1.1
Host: {{ api-host | raw }}
Authorization: Bearer {{ token | raw }}
Content-Type: application/json

{
  "{{ dynamic-field | json-key }}": {{ metadata-object | json-value }},
  "name": {{ username | json-value }},
  "description": "User bio: {{ bio | json-string }}",
  "avatar-b64": "{{ avatar-stream | stream-as-base64 }}"
}
```

**`data.json` (The Hydration Context)**
```json
{
  "api-host": "api.example.internal",
  "token": "abc123xyz",
  "dynamic-field": "user preferences",
  "metadata-object": { "theme": "dark", "notifications": false },
  "username": "Generic User",
  "bio": "Software Engineer\nLikes \"South Park\"",
  "avatar-stream": { "type": "provided", "content": 0 }
}
```

**Passing the Native Stream (SDK Example)**
```javascript
// The streams argument is passed as native memory objects
const fileStream = fs.createReadStream('./images/profile.png');
const resolved = hydrate(template, data, [ fileStream ]);
```

**`.httpt-r` (The Hydrated/Resolved Output before client execution)**
```http
POST /v1/users/update HTTP/1.1
Host: api.example.internal
Authorization: Bearer abc123xyz
Content-Type: application/json

{
  "user preferences": {"theme":"dark","notifications":false},
  "name": "Generic User",
  "description": "User bio: Software Engineer\nLikes \"South Park\"",
  "avatar-b64": "iVBORw0KGgoAAAANSUhEU..."
}
```

### 1.5.2 Example 2: Binary File Upload

*This request is hydrated via the `hydrate(template, data, streams = [])` 3-argument signature.*

**`upload-document.httpt` (The Template)**
```http
PUT /api/documents/{{ folder-name | url }}/{{ file-name | url }} HTTP/1.1
Host: api.example.com
Content-Type: application/octet-stream

{{ document-stream | stream-as-is }}
```

**`data.json` (The Hydration Context)**
```json
{
  "folder-name": "user uploads",
  "file-name": "report #1.pdf",
  "document-stream": { "type": "provided", "content": 0 }
}
```

**Passing the Native Stream (SDK Example)**
```javascript
// The streams argument is passed as native memory objects
const fileStream = fs.createReadStream('./docs/report.pdf');
const resolved = hydrate(template, data, [ fileStream ]);
```

**`.httpt-r` (The Hydrated/Resolved Output before client execution)**
```http
PUT /api/documents/user%20uploads/report%20%231.pdf HTTP/1.1
Host: api.example.com
Content-Type: application/octet-stream
:httpt-body-type: base64

JVBERi0xLjQKJ...

```

### 1.5.3 Example 3: Hydrated Requests to JSON

*Note: The original template for this output was hydrated via the `hydrate(template, data, streams = [])` 3-argument signature.*

Given the hydrated `.httpt-r` string from **Example 1**:

```http
POST /v1/users/update HTTP/1.1
Host: api.example.internal
Authorization: Bearer abc123xyz
Content-Type: application/json
:httpt-body-type: json

{
  "user preferences": { "theme": "dark", "notifications": false },
  "name": "Generic User"
}
```

The Parse Stage will output the following IR JSON:

```json
{
  "schema-version": "1.0",
  "host": "api.example.internal",
  "method": "POST",
  "uri": "/v1/users/update",
  "version": "HTTP/1.1",
  "headers": [
    { "name": "Authorization", "value": "Bearer abc123xyz" },
    { "name": "Content-Type", "value": "application/json" }
  ],
  "body": {
    "type": "json",
    "content": {
      "user preferences": {
        "theme": "dark",
        "notifications": false
      },
      "name": "Generic User"
    }
  }
}
```

### 1.5.4 Example 4: A Bodyless Request (GET)

When a request does not contain a body, the `body` key is completely omitted from the Intermediate Representation.

Given the following hydrated `.httpt-r` string:

```http
GET /api/v1/search?q=term HTTP/1.1
Host: api.example.com
Authorization: Bearer abc123xyz

```

The Parse Stage will output the following IR JSON:

```json
{
  "schema-version": "1.0",
  "host": "api.example.com",
  "method": "GET",
  "uri": "/api/v1/search?q=term",
  "version": "HTTP/1.1",
  "headers": [
    { "name": "Authorization", "value": "Bearer abc123xyz" }
  ]
}
```

## 1.6 Design Decisions & Trade-offs

### 1.6.1 Design Note: Transport Protocol & Scheme

A fundamental quirk of bridging raw HTTP with modern execution clients (like `fetch` or `curl`) is that standard origin-form HTTP requests (RFC 9110/9112) do not inherently include the `http://` or `https://` scheme.

```http
GET /api/v1/search HTTP/1.1
Host: api.example.com
```

In standard network traffic, the protocol is determined entirely by the transport layer (e.g., opening a TCP socket on port 80 vs. a TLS socket on port 443). However, because the HTTP Template *Execute Stage* hands payloads off to high-level clients that require fully qualified URLs, the Processing Workflow needs a way to resolve the scheme.

To solve this, HTTP Template approaches the problem in two phases:

#### 1.6.1.1 Current Solution: Out-of-Band Configuration
To preserve the pristine, RFC-compliant nature of `.httpt` files, the template itself remains completely ignorant of the transport protocol. The scheme and port are pushed out-of-band and provided by the execution environment.

* **CLI Environment:** Configured via flags (e.g., `httpt run --scheme https submit.httpt`).
* **SDK Environment (Dart/JS):** Passed as configuration objects (e.g., `httpt.execute(template, data, { scheme: 'https' })`).

This keeps the parser lightweight and strictly focused on verifying standard HTTP text without needing complex URI scheme resolution.

##### 1.6.1.1.1 Alternative Approaches Considered

During the design phase, we evaluated and rejected several other options to ensure the format remains pure and predictable:

* **Absolute URIs (`GET https://api.example.com/v1 HTTP/1.1`):** While technically permitted by RFC 9110/9112 (mostly for proxies), it clutters the request line and makes the required `Host` header partially redundant.
* **Port Inference from `Host`:** Guessing the scheme based on the port (e.g., assuming `:443` means `https`) is brittle. It forces the executor to default to `https` when omitted, and breaks entirely if an API runs HTTPS on a non-standard port like `8443`.
* **YAML Frontmatter:** Injecting a metadata block at the top of the file was discarded because it breaks the "it's just a raw HTTP string" philosophy and complicates the parsing Processing Workflow.

### 1.6.2 Design Note: Line Endings (\n vs \r\n)

While the official HTTP specification (RFC 9110/9112) strictly requires `CRLF` (`\r\n`) for line terminators, HTTP Template relaxes this requirement for templates.

Because the hydrated `.httpt-r` output is consumed by execution clients (e.g., `curl`, `fetch`) rather than being streamed directly to a raw TCP socket, the parser fully supports standard Unix `LF` (`\n`) line endings. This allows developers to write and format `.httpt` files naturally in any modern text editor, relying on the underlying HTTP client to enforce standard wire-level formatting during execution. If direct socket execution is supported in the future, the **output generation** can be updated to normalize line endings automatically.

### 1.6.3 Design Note: Source Mapping Trade-off

See the 'Source Mapping' subsection in the Processing Workflow (Section II) for the Index Shift Map implementation and rationale.

### 1.6.4 Design Exploration: The Identity Template
A core goal of HTTP Template is the definition of a "Canonical Identity Template." This is a specialized `.httpt` file designed to consume a full `.httpt-ir` object as its data context. The goal is to ensure that for any valid request `r`: `Execute(Parse(r)) == r`.

This problem is now functionally complete and solved. Because `hydrate` natively consumes both `headers` and `body` dynamically from the IR schema, the Canonical Identity Template requires zero complex conditional logic.

The final, exact Canonical Identity Template is as follows:

```http
{{ method | raw }} {{ uri | raw }} {{ version | raw }}
Host: {{ host | raw }}

```

This simple 2-line template, when hydrated with an IR JSON context, will perfectly reconstruct any valid HTTP request ($Execute(Parse(r)) == r$) including dynamic headers, binary streams, and bodyless `GET` requests.


# 2. HTTP Template SDK

## 2.1 Environments & Hydration Contexts

Because HTTP Template delegates the actual network request to underlying clients, the data supplied for hydration depends on the execution environment:

* **Command Line (CLI):** Operates primarily on files. You provide a `.httpt` file and a data source (e.g., via `--data payload.json`, env vars, or stdin). The CLI hydrates it into a `.httpt-r` string, parses it into the IR, and passes it directly to a standard client like `curl`.
* **JavaScript / Dart SDK:** Operates entirely in memory. You pass the template as a raw string directly to the execution function, along with a dictionary/map of your data. The library hydrates and parses it in-memory, executing the request using standard APIs like `fetch` or `dart:io HttpClient`.

*Note: When using the SDK, the `streams` array accepts native platform objects (`Uint8Array`, `ReadableStream`, etc.). When using the CLI, the runner handles mapping local file paths to these native streams before passing them to the hydrator.*

## 2.2 Static Analysis & Contract Verification

Because `.httpt` templates are often loaded dynamically at runtime, the ecosystem provides a lightweight verification library to statically analyze templates before they are hydrated or executed. This ensures that templates are syntactically sound and fulfill strict data contracts.

The verification Processing Workflow performs two distinct checks:

### 2.2.1 Structural/Syntax Verification
The verifier parses the raw `.httpt` string to ensure all templating boundaries are properly formed.
  * **Checks:** Ensures there are no unclosed brackets (e.g., `{{ missing-close | raw }}`), unrecognized built-in functions, or illegally nested tags.
  * **Failure State:** Throws a `TemplateSyntaxError` (see Appendix A).

### 2.2.2 Data Contract Verification
Developers can enforce a strict "Data Contract" by providing an array of expected argument keys. The verifier scans the template, extracts every unique parameter name defined inside the `{{ }}` blocks, and performs a strict set-equivalence check against the expected array.

  * **Missing Arguments:** If the template requires a variable (e.g., `{{ user-id | url }}`) that is *not* in the expected contract, it throws a `MissingArgumentError` (see Appendix A).
  * **Extra Arguments:** If the expected contract provides a variable (e.g., `"api-key"`) that the template *never uses*, it throws an `UnexpectedArgumentError` (see Appendix A).

### 2.2.3 Example SDK Usage
The verifier is designed to be run during initialization or CI/CD pipelines, completely bypassing the Hydrate and Parse stages.

```javascript
import { verifyContract } from '@httpt/core';

const template = `
GET /users/{{ user-id | url }} HTTP/1.1
Host: api.example.com
Authorization: Bearer {{ auth-token | raw }}
`;

// Define the strict contract the application expects to provide
const expectedArguments = ["user-id", "auth-token"];

try {
  // Returns true if the template syntax is perfect AND the arguments match exactly
  verifyContract(template, expectedArguments);
} catch (error) {
  if (error.name === 'MissingArgumentError') {
    console.error(`Template requires parameters you didn't provide: ${error.missing}`);
  } else if (error.name === 'UnexpectedArgumentError') {
    console.error(`You provided parameters the template doesn't use: ${error.extra}`);
  } else if (error.name === 'TemplateSyntaxError') {
    console.error(`Malformed template syntax at index ${error.index}`);
  }
}
```

## 2.3 The Testing Processing Workflow

Testing for the HTTP Template ecosystem is managed via a unified End-to-End (E2E) testing matrix. Please refer to `test-fixtures/e2e/README.md` and `test-fixtures/e2e/TEST_MATRIX.md` for the comprehensive test runner specification, test vectors, and coverage roadmap.


## 2.4 Developer Experience & The Smart Hydrator

**Polymorphic Template Input (Stream-In, Stream-Out):**
The SDK's `hydrate` function is highly flexible, accepting the template as either an in-memory string OR a native I/O stream (e.g., `fs.createReadStream`). If a stream is provided, it processes the template character-by-character, allowing for true O(1) memory overhead even for massive templates.

**Polymorphic Data Context:**
Developers do not need to manually manage the 3-argument signature (`hydrate(template, data, streams = [])`) or construct JSON pointers. The `streams` argument is optional (nullable/defaults to an empty array). The SDK accepts a single data object containing primitives, JSON, and native streams. The SDK automatically extracts these streams, maps them to the internal engine, and replaces them with `{ "type": "provided", "content": index }` pointers under the hood.

```javascript
import fs from 'fs';
import { hydrate } from '@httpt/core';

// Both the template and a data variable are passed as native streams
const templateStream = fs.createReadStream('upload.httpt');
const fileStream = fs.createReadStream('large-video.mp4');

const data = {
  userId: "user_123",
  file: fileStream
};

// The SDK handles stream extraction and mapping automatically
const hydrated = await hydrate(templateStream, data);
```

## 2.5 SDK API Reference

### 2.5.1 The Core Pipeline (Low-Level)
* **`hydrate(template: Resolvable, data: Object, streams: NativeStream[]) -> { resolved: String | Stream, map: Array, bodyStream: NativeStream | null }`**:
  * *Description:* The state machine. Executes single-pass substitution, materializes metadata streams, concatenates body streams, and generates the Index Shift Map.
* **`parse(resolved: Stream | String, optionalBodyStream: NativeStream | null) -> { ir: Object, bodyStream: NativeStream | null }`**:
  * *Description:* The boundary deconstructor. Scans for the `\n\n` boundary, constructs the HTTP Head, consumes `:httpt-body-type`, and hands off the unread body stream.
* **`dispatch* (Execution Adapters)`**:
  * *Description:* A suite of environment-specific target execution functions. Note that `bodyStream` is nullable because text/JSON bodies are passed directly inside the `ir` object.
  * `dispatchFetch(ir: Object, scheme: String, bodyStream: NativeStream | null)`: Maps IR to the Web API `fetch()` configuration.
  * `dispatchDart(ir: Object, scheme: String, bodyStream: NativeStream | null)`: Maps IR to `dart:io` `HttpClient`.
  * `dispatchCurl(ir: Object, scheme: String, bodyStream: NativeStream | null)`: Translates IR into `curl` command-line arguments and spawns a sub-process.

### 2.5.2 Core SDK Methods (The Facade)
* **`build(template: Resolvable, data: Object, streams: NativeStream[] = []) -> { ir: Object, map: Array, bodyStream: NativeStream | null }`**:
  * *Description:* Orchestrates `hydrate` + `parse`. While the Smart Hydrator can extract streams from the `data` object automatically, users can also explicitly provide the `streams` array. Returns the structured Intermediate Representation (IR), the Index Shift Map, and the O(1) body stream. Ideal for developers bringing their own HTTP clients (e.g., Axios).
* **`execute(template: Resolvable, data: Object, streams: NativeStream[] = [], config: Object) -> Promise<Response>`**:
  * *Description:* The ultimate single-entry point. Orchestrates `hydrate` -> `parse` -> `executeTarget`. The `config` object handles out-of-band network requirements (e.g., `{ scheme: 'https' }`). The user provides a template, data, and optional streams, and receives a standard HTTP Response object back with all streaming handled transparently.


# 3. Future Explorations


## 3.1 Response Templating

While HTTP Template is currently designed around HTTP requests, the underlying RFC 9112 structure for HTTP responses is nearly identical (differing only by replacing the Request-Line with a Status-Line).

Expanding HTTP Template to template responses unlocks two powerful workflows:

Mocking: Standing up local mock servers that serve hydrated .httpt response templates.
Asserting: Firing a real request and verifying the server's output against a .httpt response template during integration testing.
Because the Hydrate Stage is agnostic to whether it is processing a request or a response, supporting this requires minimal Processing Workflow changes:

Parser State: The parser's Request Line evaluation must branch at the root to accept either a Request-Line or a Status-Line.
IR Schema: The Intermediate Representation (IR) JSON must introduce a root type field (e.g., "type": "request" | "response") so the downstream Execute Stage knows how to interpret the payload.

## 3.2 Roadmap & Contributing

HTTP Template is currently in active incubation. The overarching goal is to build out the parsing and execution Processing Workflow so that `.httpt-ir` files can eventually be executed by any underlying HTTP client (like `fetch`, `curl`, or Dart's `HttpClient`).

If you are interested in building out execution clients, contributing to the parser, or writing static analysis tooling, please refer to the schemas defined in this document.


# Appendix A: Error Dictionary

* **`BodyConflictError`**: Thrown during the Hydration stage when `data.body` is provided but the source `.httpt` template also contains non-whitespace characters after its double-newline boundary.
* **`TemplateSyntaxError`**: Thrown during static analysis when the `.httpt` syntax is malformed (e.g., unclosed brackets, unrecognized functions, illegally nested tags), indicating the exact line and character index of the error.
* **`MissingArgumentError`**: Thrown during static analysis when the template requires a variable that is not provided in the expected contract.
* **`UnexpectedArgumentError`**: Thrown during static analysis when the expected contract provides a variable that the template never uses.
