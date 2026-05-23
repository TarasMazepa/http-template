# I. Introduction & Philosophy

**HTTP Template** is a templating tool for defining HTTP requests using a syntax that resolves into raw HTTP format (RFC 9110/9112).

At its core, it performs string replacement on raw HTTP text. To handle the data formatting required for valid HTTP requests, it provides a set of explicit functions to encode parameters (e.g., JSON escaping, URL encoding, or binary file streaming).

The tool consumes a template, hydrates it using a data context, and outputs a structured JSON Intermediate Representation (`.httpt-ir`). This IR can then be used by various execution clients to perform the actual network request.

This document serves as the technical specification for the templating syntax, the parsing workflow, and the IR schema.

## The Format of .httpt

At its core, the structure of an `.httpt` file is **modeled after** the standard HTTP message format (RFC 9110/9112). While the source template (`.httpt`) may contain placeholders that do not conform to HTTP syntax, the *hydrated result* (`.httpt-r`) must structurally represent a valid HTTP request. The file is always divided into three distinct parts:

1. **The Request Line:** Defines the method, the target URI (which can be templated), and the HTTP version.
2. **The Headers:** A list of key-value pairs.
3. **The Body (Optional):** Separated from the headers by a mandatory blank line.

## Anatomy of the Template

```http
[METHOD] [PATH_AND_QUERY] [HTTP_VERSION]
[Header-Name]: [Header-Value]
[Header-Name]: [Header-Value]

[Optional Body]
```

# II. The Parsing & Execution Processing Workflow

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

# III. The Source Template (.httpt)

## Templating Syntax

Templates use a linear processing workflow based on data injection and transformations. The basic syntax is:
`{{ parameter | function-name }}`

To apply multiple transformations, chain them using the pipe operator (`|`). Functions are processed from left to right:
`{{ parameter | function-one | function-two(arg-one, arg-two) }}`

* Parameters refer to keys in the data context (e.g., `user-id`).
* Functions are specific transformations applied to the data before injection into the HTTP stream.

## Built-in Escaping Options

#### Core Functions
These handle basic data injection and URL safety.

* **raw Mechanism** / Injects / the variable exactly as provided in the data map with zero escaping or transformation. Mandatory for all direct injections (`{{ host-url | raw }}`).
* **url Mechanism** / Encodes / the value (e.g., space becomes `%20`, `#` becomes `%23`) for safe use in URL paths or query parameters (`{{ path | url }}`).

#### JSON Functions
Designed to allow precise control over JSON structure without breaking syntax. Similar granular patterns (`xml-*`, `yml-*`) will follow in the future.

* **json-value Mechanism** / Serializes / the parameter into its JSON representation (e.g., boolean `true`, list `[1,2]`, object `{"k":"v"}`). If the variable is a string, it includes the surrounding quotes. If it is a boolean or number, it remains unquoted (`{{ obj | json-value }}`).
* **json-string Mechanism** / Escapes / internal characters only (e.g., newlines, tabs, and internal double quotes `"` becomes `\"`). It does not wrap the output in quotes, allowing it to be concatenated inside a larger string (`{{ bio | json-string }}`).
* **json-key Mechanism** / Escapes / a string specifically for use as a JSON property key (`{{ name | json-key }}`).

#### File Functions
These functions instruct the execution engine how to resolve a local file path into a payload.

* **file-as-base64 Mechanism** / Encodes / the binary content of a file into a Base64 string, ideal for JSON image uploads (`{{ path | file-as-base64 }}`).
* **file-as-utf8 Mechanism** / Reads / a local file and ensures the content is encoded as UTF-8 in the request body. Useful for injecting external text, GraphQL queries, or XML.
* **file-as-is Mechanism** / Streams / the file as a raw binary stream, bypassing text encoding. This is used for `multipart/form-data` uploads or binary body transfers.
* **multipart/form-data (Note):** Multipart requests are single HTTP requests. The body is divided into multiple sections, separated by a `boundary` string defined in the `Content-Type` header.

## Common Cases & Variations

HTTP Template supports common HTTP request patterns through explicit function-based variable substitution.

#### Case 1: GET/DELETE
Standard requests without a body pass dynamic data via query parameters. Use the `{{ parameter | url }}` function to ensure parameters are correctly percent-encoded.

```http
GET /api/v1/search?q={{ search-term | url }}&limit={{ limit-count | raw }} HTTP/1.1
Host: {{ api-host | raw }}
Authorization: Bearer {{ auth-token | raw }}
Accept: application/json

```
*(Note the trailing blank line to indicate the end of the headers, even when there is no body).*

#### Case 2: Structured Payloads (JSON/XML)
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

#### Case 3: Form URL-Encoded
For form submissions, set the `Content-Type` to `application/x-www-form-urlencoded` and use `{{ parameter | url }}` for all form field values.

```http
POST /oauth/token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={{ client-id | url }}&client_secret={{ secret-key | url }}
```

#### Case 4: Multipart Form Data
For file uploads, set the `Content-Type` to `multipart/form-data` and include a `boundary` definition. Use `{{ parameter | file-as-is }}` to inject binary data into specific body parts.

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

{{ document-path | file-as-is }}
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```

# IV. The Intermediate Representation (.httpt-ir)

## The Intermediate Representation (IR)

Once the Parse Stage **deconstructs** the hydrated `.httpt-r` string, it maps the extracted HTTP components into a strictly defined Intermediate Representation (IR).

To ensure maximum portability across execution environments (Dart, Node.js, CLI) and to enable deterministic unit testing, the IR is defined as a standard JSON structure. This serves as the definitive contract between the *Parse Stage* and the *Execute Stage*.

*(Note: While the Intermediate Representation is structurally a standard JSON object, it is saved to disk using the proprietary `.httpt-ir` extension to maintain the ecosystem namespace and avoid tooling conflicts).*

## Bridging the Representation Gap

Because the hydrated `.httpt-r` and `.httpt-ir` files are flat text streams, the parser needs a mechanism to determine the body type without content-sniffing. This is handled via the `:httpt-body-type` pseudo-header:

* `:httpt-body-type: provided`: Signals that the body content is handled as an in-memory reference (e.g., stream, Blob, or Buffer). This avoids serialization and disk I/O for large payloads or live streams. The body is omitted from the intermediate file contents.
* `:httpt-body-type: base64`: Signals that the binary data is embedded directly in the intermediate text files as a Base64-encoded string. This ensures the data persists in a text-based format where streaming is not feasible.
* `:httpt-body-type: text` (Default): Signals that the body is a standard UTF-8 string. This is the default if no pseudo-header is present.
- `:httpt-body-type: json`: Signals that the body is a JSON string. The Parse Stage **must** buffer this content and parse it into a native JSON object or array for the IR `content` field. (Note: This is an exception to the O(1) body handoff rule, as the parser must read the full body to perform validation and conversion).

**Implementation Note:** The parser consumes this pseudo-header to set the IR `body.type` and **MUST strictly remove it** from the final header set. It is an internal artifact and is never part of the executed HTTP request.

## IR JSON Schema

The JSON object represents the fully resolved request, stripped of all internal parsing artifacts.

* **`schema-version`**: The version of the IR structure (currently `"1.0"`).
* **`host`**: The extracted target host/authority for the request (e.g., `"api.production.internal"`). Note: The Parse Stage should extract the `Host` header (or `:authority` pseudo-header) to populate this root field.
* **`method`**: The HTTP method (e.g., `GET`, `POST`).
* **`uri`**: The exact target path and query string (e.g., `/api/v1/search?q=term`).
* **`version`**: The HTTP protocol version (e.g., `HTTP/1.1`).
* **`headers`**: An array of key-value objects. An array is used instead of a standard JSON dictionary to safely preserve multiple headers with the exact same name without data loss.
* `body` *(Optional)*: An object defining the payload structure using a discriminated union.
  * `type`: Indicates how the execution client should handle the content. Strict allowed values:
    * `"text"`: A standard UTF-8 string payload (used for URL-encoded forms, XML, HTML, or raw strings). The executor sends it exactly as-is.
    * `"base64"`: A Base64 encoded string. The executor must decode this into a raw byte array before sending over the wire.
    * `"json"`: A JSON object or array. The executor natively stringifies this object (e.g., JSON.stringify()) before sending, avoiding the need for double-escaped strings in the IR.
    * `"provided"`: Indicates the payload is provided out-of-band at runtime (e.g., passing a file stream, Blob, or Buffer directly to the execution function).
  * `content`: The actual payload data (String for `text`/`base64`, Object/Array for `json`). This key is omitted when the type is `"provided"`.

# V. End-to-End Examples

## End-to-End Examples

### Example 1: Complex User Update Request

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
  "avatar-b64": "{{ avatar-path | file-as-base64 }}"
}
```

**`data.json` (The Hydration Context)**
```json
{
  "api-host": "api.production.internal",
  "token": "abc123xyz",
  "dynamic-field": "user preferences",
  "metadata-object": { "theme": "dark", "notifications": false },
  "username": "Taras Mazepa",
  "bio": "Software Engineer\nLikes \"South Park\"",
  "avatar-path": "./images/profile.png"
}
```

**`.httpt-r` (The Hydrated/Resolved Output before client execution)**
```http
POST /v1/users/update HTTP/1.1
Host: api.production.internal
Authorization: Bearer abc123xyz
Content-Type: application/json

{
  "user preferences": {"theme":"dark","notifications":false},
  "name": "Taras Mazepa",
  "description": "User bio: Software Engineer\nLikes \"South Park\"",
  "avatar-b64": "iVBORw0KGgoAAAANSUhEU..."
}
```

### Example 2: Binary File Upload

**`upload-document.httpt` (The Template)**
```http
PUT /api/documents/{{ folder-name | url }}/{{ file-name | url }} HTTP/1.1
Host: api.example.com
Content-Type: application/octet-stream

{{ document-path | file-as-is }}
```

**`data.json` (The Hydration Context)**
```json
{
  "folder-name": "user uploads",
  "file-name": "report #1.pdf",
  "document-path": "./docs/report.pdf"
}
```

**`.httpt-r` (The Hydrated/Resolved Output before client execution)**
```http
PUT /api/documents/user%20uploads/report%20%231.pdf HTTP/1.1
Host: api.example.com
Content-Type: application/octet-stream

<Binary Stream: ./docs/report.pdf>
```

### Example 3: Hydrated Requests to JSON

Given the hydrated `.httpt-r` string from **Scenario 1**:

```http
POST /v1/users/update HTTP/1.1
Host: api.production.internal
Authorization: Bearer abc123xyz
Content-Type: application/json
:httpt-body-type: json

{
  "user preferences": { "theme": "dark", "notifications": false },
  "name": "Taras Mazepa"
}
```

The Parse Stage will output the following IR JSON:

```json
{
  "schema-version": "1.0",
  "host": "api.production.internal",
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
      "name": "Taras Mazepa"
    }
  }
}
```

### Example 4: A Bodyless Request (GET)

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

# VI. Ecosystem & Tooling

## Environments & Hydration Contexts

Because HTTP Template delegates the actual network request to underlying clients, the data supplied for hydration depends on the execution environment:

* **Command Line (CLI):** Operates primarily on files. You provide a `.httpt` file and a data source (e.g., via `--data payload.json`, env vars, or stdin). The CLI hydrates it into a `.httpt-r` string, parses it into the IR, and passes it directly to a standard client like `curl`.
* **JavaScript / Dart SDK:** Operates entirely in memory. You pass the template as a raw string directly to the execution function, along with a dictionary/map of your data. The library hydrates and parses it in-memory, executing the request using standard APIs like `fetch` or `dart:io HttpClient`.

## Static Analysis & Contract Verification

Because `.httpt` templates are often loaded dynamically at runtime, the ecosystem provides a lightweight verification library to statically analyze templates before they are hydrated or executed. This ensures that templates are syntactically sound and fulfill strict data contracts.

The verification Processing Workflow performs two distinct checks:

### 1. Structural/Syntax Verification
The verifier parses the raw `.httpt` string to ensure all templating boundaries are properly formed.
  * **Checks:** Ensures there are no unclosed brackets (e.g., `{{ missing-close | raw }}`), unrecognized built-in functions, or illegally nested tags.
  * **Failure State:** Throws a `TemplateSyntaxError` indicating the exact line and character index of the malformed syntax.

### 2. Data Contract Verification
Developers can enforce a strict "Data Contract" by providing an array of expected argument keys. The verifier scans the template, extracts every unique parameter name defined inside the `{{ }}` blocks, and performs a strict set-equivalence check against the expected array.

  * **Missing Arguments:** If the template requires a variable (e.g., `{{ user-id | url }}`) that is *not* in the expected contract, it throws a `MissingArgumentError`.
  * **Extra Arguments:** If the expected contract provides a variable (e.g., `"api-key"`) that the template *never uses*, it throws an `UnexpectedArgumentError` (preventing unused or deprecated data from lingering in execution contexts).

### Example SDK Usage
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

## The Testing Processing Workflow

Defining the IR as JSON unlocks a highly decoupled testing Processing Workflow:

1.  **Parser Tests (`.httpt-r` -> `.httpt-ir`):** Feed raw HTTP strings into the parser and assert the exact JSON output.
2.  **Executor Tests (`.httpt-ir` -> Network):** Feed mock IR files into the execution engine and assert that the correct `curl` arguments or `fetch` configurations are generated.

# VII. Design Decisions & Trade-offs

### Design Note: Transport Protocol & Scheme

A fundamental quirk of bridging raw HTTP with modern execution clients (like `fetch` or `curl`) is that standard origin-form HTTP requests (RFC 9110/9112) do not inherently include the `http://` or `https://` scheme.

```http
GET /api/v1/search HTTP/1.1
Host: api.example.com
```

In standard network traffic, the protocol is determined entirely by the transport layer (e.g., opening a TCP socket on port 80 vs. a TLS socket on port 443). However, because the HTTP Template *Execute Stage* hands payloads off to high-level clients that require fully qualified URLs, the Processing Workflow needs a way to resolve the scheme.

To solve this, HTTP Template approaches the problem in two phases:

### 1. Current Solution: Out-of-Band Configuration
To preserve the pristine, RFC-compliant nature of `.httpt` files, the template itself remains completely ignorant of the transport protocol. The scheme and port are pushed out-of-band and provided by the execution environment.

* **CLI Environment:** Configured via flags (e.g., `httpt run --scheme https submit.httpt`).
* **SDK Environment (Dart/JS):** Passed as configuration objects (e.g., `httpt.execute(template, data, { scheme: 'https' })`).

This keeps the parser lightweight and strictly focused on verifying standard HTTP text without needing complex URI scheme resolution.

#### Alternative Approaches Considered

During the design phase, we evaluated and rejected several other options to ensure the format remains pure and predictable:

* **Absolute URIs (`GET https://api.example.com/v1 HTTP/1.1`):** While technically permitted by RFC 9110/9112 (mostly for proxies), it clutters the request line and makes the required `Host` header partially redundant.
* **Port Inference from `Host`:** Guessing the scheme based on the port (e.g., assuming `:443` means `https`) is brittle. It forces the executor to default to `https` when omitted, and breaks entirely if an API runs HTTPS on a non-standard port like `8443`.
* **YAML Frontmatter:** Injecting a metadata block at the top of the file was discarded because it breaks the "it's just a raw HTTP string" philosophy and complicates the parsing Processing Workflow.

### Design Note: Line Endings (\n vs \r\n)

While the official HTTP specification (RFC 9110/9112) strictly requires `CRLF` (`\r\n`) for line terminators, HTTP Template relaxes this requirement for templates.

Because the hydrated `.httpt-r` output is consumed by execution clients (e.g., `curl`, `fetch`) rather than being streamed directly to a raw TCP socket, the parser fully supports standard Unix `LF` (`\n`) line endings. This allows developers to write and format `.httpt` files naturally in any modern text editor, relying on the underlying HTTP client to enforce standard wire-level formatting during execution. If direct socket execution is supported in the future, the **output generation** can be updated to normalize line endings automatically.

### Design Note: Source Mapping Trade-off

See the 'Source Mapping' subsection in the Processing Workflow (Section II) for the Index Shift Map implementation and rationale.

## Design Exploration: The Identity Template
An open area of exploration is the definition of a "Canonical Identity Template." This would be a specialized .httpt file designed to consume a full .httpt-ir object as its data context. The goal is to ensure that for any valid request r: Execute(Parse(r)) == r. This requires further thought on how to "splat" a collection of headers into the template without complex loop logic.


# VIII. Future Explorations

## Future Explorations

### Future Exploration: Response Templating

While HTTP Template is currently designed around HTTP requests, the underlying RFC 9112 structure for HTTP responses is nearly identical (differing only by replacing the Request-Line with a Status-Line).

Expanding HTTP Template to template responses unlocks two powerful workflows:

Mocking: Standing up local mock servers that serve hydrated .httpt response templates.
Asserting: Firing a real request and verifying the server's output against a .httpt response template during integration testing.
Because the Hydrate Stage is agnostic to whether it is processing a request or a response, supporting this requires minimal Processing Workflow changes:

Parser State: The parser's Request Line evaluation must branch at the root to accept either a Request-Line or a Status-Line.
IR Schema: The Intermediate Representation (IR) JSON must introduce a root type field (e.g., "type": "request" | "response") so the downstream Execute Stage knows how to interpret the payload.

## Roadmap & Contributing

HTTP Template is currently in active incubation. The overarching goal is to build out the parsing and execution Processing Workflow so that `.httpt-ir` files can eventually be executed by any underlying HTTP client (like `fetch`, `curl`, or Dart's `HttpClient`).

If you are interested in building out execution clients, contributing to the parser, or writing static analysis tooling, please refer to the schemas defined in this document.
