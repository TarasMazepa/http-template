# I. Introduction & Philosophy

**HTTP Template** is a templating tool for defining HTTP requests in raw HTTP format (RFC 9110/9112).

At its core, it performs string replacement on raw HTTP text. To handle the data formatting required for valid HTTP requests, it provides a set of explicit functions to encode variables (e.g., JSON escaping, URL encoding, or binary file streaming).

The tool consumes a template, hydrates it using a data context, and outputs a structured JSON Intermediate Representation (`.httpt-ir`). This IR can then be used by various execution clients to perform the actual network request.

This document serves as the technical specification for the templating syntax, the parsing workflow, and the IR schema.

## The Format of .httpt

At its core, an `.httpt` file adheres to the standard HTTP message format (RFC 9110/9112). The template must structurally represent a valid HTTP request *before* and *after* hydration. The file is always divided into three distinct parts:

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

## Parsing & Execution Processing Workflow

The execution of an `.httpt` file relies on a highly optimized, custom native processing workflow.

* **Hydrate Stage Mechanism (Single-Pass State Machine)** / Implements / hydration as a single-pass streaming state machine rather than relying on heavy regex engines or intermediate ASTs.
  * **Input:** Consumes either a file stream or an in-memory string, reading it character-by-character.
  * **Output:** Writes in-place, outputting either directly to a hydrated `.httpt-r` file ("Resolved") or streaming directly into the downstream custom native parser.
  * **Performance:** Achieves O(1) memory overhead since it does not build intermediate data structures for the template logic.
  * **Source Mapping:** The Index Shift Map is generated effortlessly on the fly during this single pass by tracking the integer differences between a `readCursor` and a `writeCursor` whenever a `{{ function param }}` tag is resolved.
* **Parse & Verify Stage Mechanism (Custom Native Parser)** / Verifies / the hydrated `.httpt-r` string or stream using a fast, native parser designed for a strict subset of HTTP.
  * **Separation of Head and Body:** The parser scans the hydrated string or stream strictly for the first double newline (`\r\n\r\n` or `\n\n`). Everything before is the Head; everything after is the Body. *(See Design Note: Line Endings in Section VII for rationale).*
  * **Head Parsing:** The Request Line and Headers are parsed using fast, native string splitting. The Request Line is split by spaces, and headers are split by the first colon (`:`).
  * **O(1) Body Handoff:** The parser stops reading exactly at the double newline boundary. The unread remainder of the stream (the Body) is handed off directly to the downstream execution client without being buffered or mapped into memory.
  * **Error Handling:** Syntax errors (like malformed headers) caught during this native string splitting must still query the **Index Shift Map** to point the error back to the exact character index in the user's original `.httpt` file.
* **Execute Stage Mechanism** / Hands off / the fully resolved request to the execution client (e.g., `fetch`, `curl`) if the parsed request is valid.

# III. The Source Template (.httpt)

## Templating Syntax

Rather than providing implicit context-aware escaping, HTTP Template prioritizes explicit user control. The syntax is inspired by Handlebars/Nunjucks but is strictly function-based: `{{ function parameter_name }}`. Here, `parameter_name` refers to the key in the data context, not the literal value.

**Note:** The default syntax without a function (e.g., `{{ parameter_name }}`) is invalid. Users *must* explicitly define how the data enters the HTTP stream. This ensures that the hydration state machine can catch malformed templates immediately and forces developer explicitness.

## Built-in Escaping Options

#### Core Functions
These handle basic data injection and URL safety.

* **raw Mechanism** / Injects / the variable exactly as provided in the data map with zero escaping or transformation. Mandatory for all direct injections (`{{ raw host_url }}`).
* **url Mechanism** / Percent-encodes / the value (e.g., space becomes `%20`, `#` becomes `%23`) for safe use in URL paths or query parameters (`{{ url path }}`).

#### JSON Functions
Designed to allow precise control over JSON structure without breaking syntax. Similar granular patterns (`xml-*`, `yml-*`) will follow in the future.

* **json-value Mechanism** / Serializes / the parameter into its native JSON representation (e.g., boolean `true`, list `[1,2]`, object `{"k":"v"}`). If the variable is a string, it includes the surrounding quotes. If it is a boolean or number, it remains unquoted (`{{ json-value obj }}`).
* **json-string Mechanism** / Escapes / internal characters only (e.g., newlines, tabs, and internal double quotes `"` becomes `\"`). It does not wrap the output in quotes, allowing it to be concatenated inside a larger string (`{{ json-string bio }}`).
* **json-key Mechanism** / Safely escapes / a string specifically for use as a JSON property key (`{{ json-key name }}`).

#### File Functions
These functions instruct the execution engine how to resolve a local file path into a payload.

* **file-as-base64 Mechanism** / Encodes / the binary content of a file into a Base64 string, ideal for JSON image uploads (`{{ file-as-base64 path }}`).
* **file-as-utf8 Mechanism** / Reads / the file as a UTF-8 text string, useful for injecting external GraphQL queries or XML blocks (`{{ file-as-utf8 path }}`).
* **file-as-is Mechanism** / Signals / the engine to treat the value as a raw binary stream, used for `multipart/form-data` or binary body uploads (`{{ file-as-is path }}`).

## Common Cases & Variations

Depending on the API being called, the "raw HTTP" structure will look different. Here are the primary cases `.httpt` files will need to support:

#### Case 1: Query Parameter Driven (GET / DELETE)
In requests without a body, the complexity lives entirely in the Request Line. The `{{ url }}` function is critical here to ensure query parameters don't break the HTTP request line structure.

```http
GET /api/v1/search?q={{ url search_term }}&limit={{ raw limit_count }} HTTP/1.1
Host: {{ raw api_host }}
Authorization: Bearer {{ raw auth_token }}
Accept: application/json

```
*(Note the trailing blank line to indicate the end of the headers, even when there is no body).*

#### Case 2: Standard Structured Payloads (JSON / XML)
This is the most common use case. The user must explicitly define the `Content-Type` so the system knows what kind of payload is being sent. However, the `Content-Length` header is intentionally omitted from the template; the underlying HTTP execution client (e.g., `curl`, `fetch`) will automatically calculate and append it based on the final hydrated payload.

```http
POST /v1/webhooks HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "event": "{{ json-string event_name }}",
  "payload": {{ json-value event_data }}
}
```

#### Case 3: Form URL-Encoded (`application/x-www-form-urlencoded`)
A classic format where the body mimics query parameters. The `{{ url }}` function must be used for every value injected into the body to prevent breaking the `&` and `=` delimiters.

```http
POST /oauth/token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={{ url client_id }}&client_secret={{ url secret_key }}
```

#### Case 4: Multipart Form Data
This is the most complex "raw HTTP" structure because it requires the user to manually define boundary markers. HTTP Template shines here by allowing binary streams to be injected directly between text boundaries using `{{ file-as-is }}`.

```http
POST /api/uploads HTTP/1.1
Host: api.example.com
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="description"

{{ raw file_description }}
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="document"; filename="{{ raw file_name }}"
Content-Type: application/pdf

{{ file-as-is document_path }}
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```

# IV. The Intermediate Representation (.httpt-ir)

## The Intermediate Representation (IR)

Once the Parse Stage successfully verifies the hydrated `.httpt-r` string, it maps the extracted HTTP components into a strictly defined **Intermediate Representation (IR)**.

To ensure maximum portability across execution environments (Dart, Node.js, CLI) and to enable deterministic unit testing, the IR is defined as a standard JSON structure. This serves as the definitive contract between the *Parse Stage* and the *Execute Stage*.

*(Note: While the Intermediate Representation is structurally a standard JSON object, it is saved to disk using the proprietary `.httpt-ir` extension to maintain the ecosystem namespace and avoid tooling conflicts).*

## Bridging the Representation Gap

Because the hydrated `.httpt-r` file is a flat text stream, the Custom Native Parser needs a mechanism to determine the strict JSON `body.type` (e.g., distinguishing between a raw string and a Base64 encoded binary file) without relying on fragile sniffing.

To solve this, the Hydrate stage injects a custom pseudo-header into the `.httpt-r` output: `:httpt-body-type`.

* If the template uses `{{ file-as-is ... }}`, the Hydrator injects `:httpt-body-type: provided` and omits the body entirely from the `.httpt-r` stream.
* If the template uses `{{ file-as-base64 ... }}`, the Hydrator injects `:httpt-body-type: base64` and writes the encoded string into the `.httpt-r` body.
* For standard `text` or `json` payloads, the pseudo-header is optional (the parser will default to `text`, or infer `json` from the `Content-Type` header).

**CRITICAL:** The Parse Stage consumes this pseudo-header to build the `.httpt-ir` JSON, but it **MUST strictly remove** the `:httpt-body-type` header from the final IR output. It is an internal parsing artifact and must never be handed off to the Execute stage or sent over the network.

## IR JSON Schema

The JSON object represents the fully resolved request, stripped of all internal parsing artifacts.

* **`schema-version`**: The version of the IR structure (currently `"1.0"`).
* **`host`**: The extracted target host/authority for the request (e.g., `"api.production.internal"`). Note: The Parse Stage should extract the `Host` header (or `:authority` pseudo-header) to populate this root field.
* **`method`**: The HTTP method (e.g., `GET`, `POST`).
* **`uri`**: The exact target path and query string (e.g., `/api/v1/search?q=term`).
* **`version`**: The HTTP protocol version (e.g., `HTTP/1.1`).
* **`headers`**: An array of key-value objects. An array is used instead of a standard JSON dictionary to safely preserve multiple headers with the exact same name without data loss.
- `body` *(Optional)*: An object defining the payload structure using a discriminated union.
  - `type`: Indicates how the execution client should handle the content. Strict allowed values:
    - `"text"`: A standard UTF-8 string payload (used for URL-encoded forms, XML, HTML, or raw strings). The executor sends it exactly as-is.
    - `"base64"`: A Base64 encoded string. The executor must decode this into a raw byte array before sending over the wire.
    - `"json"`: A native JSON object or array. The executor natively stringifies this object (e.g., `JSON.stringify()`) before sending, avoiding the need for double-escaped strings in the IR.
    - `"provided"`: Indicates the payload is provided out-of-band at runtime (e.g., passing a file stream, Blob, or Buffer directly to the execution function).
  - `content`: The actual payload data (String for `text`/`base64`, Object/Array for `json`). This key is omitted when the type is `"provided"`.

# V. End-to-End Examples

## End-to-End Examples

### Example 1: Complex User Update Request

**`update-user.httpt` (The Template)**
```http
POST /v1/users/update HTTP/1.1
Host: {{ raw api_host }}
Authorization: Bearer {{ raw token }}
Content-Type: application/json

{
  "{{ json-key dynamic_field }}": {{ json-value metadata_object }},
  "name": {{ json-value username }},
  "description": "User bio: {{ json-string bio }}",
  "avatar_b64": "{{ file-as-base64 avatar_path }}"
}
```

**`data.json` (The Hydration Context)**
```json
{
  "api_host": "api.production.internal",
  "token": "abc123xyz",
  "dynamic_field": "user preferences",
  "metadata_object": { "theme": "dark", "notifications": false },
  "username": "Taras Mazepa",
  "bio": "Software Engineer\nLikes \"South Park\"",
  "avatar_path": "./images/profile.png"
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
  "avatar_b64": "iVBORw0KGgoAAAANSUhEU..."
}
```

### Example 2: Binary File Upload

**`upload-document.httpt` (The Template)**
```http
PUT /api/documents/{{ url folder_name }}/{{ url file_name }} HTTP/1.1
Host: api.example.com
Content-Type: application/octet-stream

{{ file-as-is document_path }}
```

**`data.json` (The Hydration Context)**
```json
{
  "folder_name": "user uploads",
  "file_name": "report #1.pdf",
  "document_path": "./docs/report.pdf"
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
  "method": "GET",
  "uri": "/api/v1/search?q=term",
  "version": "HTTP/1.1",
  "headers": [
    { "name": "Host", "value": "api.example.com" },
    { "name": "Authorization", "value": "Bearer abc123xyz" }
  ]
}
```

# VI. Ecosystem & Tooling

## Environments & Hydration Contexts

Because HTTP Template delegates the actual network request to underlying clients, the data supplied for hydration depends on the execution environment:

* **Command Line (CLI):** Operates primarily on files. You provide a `.httpt` file and a data source (e.g., via `--data payload.json`, env vars, or stdin). The CLI hydrates it into a `.httpt-r` string, parses it into the IR, and passes it directly to a standard client like `curl`.
* **JavaScript / Dart SDK:** Operates entirely in memory. You pass the template as a raw string directly to the execution function, along with a native dictionary/map of your data. The library hydrates and parses it in-memory, executing the request using standard APIs like `fetch` or `dart:io HttpClient`.

## Static Analysis & Contract Verification

Because `.httpt` templates are often loaded dynamically at runtime, the ecosystem provides a lightweight verification library to statically analyze templates before they are hydrated or executed. This ensures that templates are syntactically sound and fulfill strict data contracts.

The verification processing workflow performs two distinct checks:

### 1. Structural/Syntax Verification
The verifier parses the raw `.httpt` string to ensure all templating boundaries are properly formed.
* **Checks:** Ensures there are no unclosed brackets (e.g., `{{ raw missing_close `), unrecognized built-in functions, or illegally nested tags.
* **Failure State:** Throws a `TemplateSyntaxError` indicating the exact line and character index of the malformed syntax.

### 2. Data Contract Verification
Developers can enforce a strict "Data Contract" by providing an array of expected argument keys. The verifier scans the template, extracts every unique parameter name defined inside the `{{ }}` blocks, and performs a strict set-equivalence check against the expected array.

* **Missing Arguments:** If the template requires a variable (e.g., `{{ url user_id }}`) that is *not* in the expected contract, it throws a `MissingArgumentError`.
* **Extra Arguments:** If the expected contract provides a variable (e.g., `"api_key"`) that the template *never uses*, it throws an `UnexpectedArgumentError` (preventing unused or deprecated data from lingering in execution contexts).

### Example SDK Usage
The verifier is designed to be run during initialization or CI/CD pipelines, completely bypassing the Hydrate and Parse stages.

```javascript
import { validateContract } from '@httpt/core';

const template = `
GET /users/{{ url user_id }} HTTP/1.1
Host: api.example.com
Authorization: Bearer {{ raw auth_token }}
`;

// Define the strict contract the application expects to provide
const expectedArguments = ["user_id", "auth_token"];

try {
  // Returns true if the template syntax is perfect AND the arguments match exactly
  validateContract(template, expectedArguments);
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

Defining the IR as JSON unlocks a highly decoupled testing processing workflow:

1.  **Parser Tests (`.httpt-r` -> `.httpt-ir`):** Feed raw HTTP strings into the native parser and assert the exact JSON output.
2.  **Executor Tests (`.httpt-ir` -> Network):** Feed mock IR files into the execution engine and assert that the correct `curl` arguments or `fetch` configurations are generated.

# VII. Design Decisions & Trade-offs

## Design Decisions & Trade-offs

### Design Note: Transport Protocol & Scheme

A fundamental quirk of bridging raw HTTP with modern execution clients (like `fetch` or `curl`) is that standard origin-form HTTP requests (RFC 9110/9112) do not inherently include the `http://` or `https://` scheme.

```http
GET /api/v1/search HTTP/1.1
Host: api.example.com
```

In standard network traffic, the protocol is determined entirely by the transport layer (e.g., opening a TCP socket on port 80 vs. a TLS socket on port 443). However, because the HTTP Template *Execute Stage* hands payloads off to high-level clients that require fully qualified URLs, the processing workflow needs a way to resolve the scheme.

To solve this, HTTP Template approaches the problem in two phases:

### 1. Current Solution: Out-of-Band Configuration
To preserve the pristine, RFC-compliant nature of `.httpt` files, the template itself remains completely ignorant of the transport protocol. The scheme and port are pushed out-of-band and provided by the execution environment.

* **CLI Environment:** Configured via flags (e.g., `httpt run --scheme https submit.httpt`).
* **SDK Environment (Dart/JS):** Passed as configuration objects (e.g., `httpt.execute(template, data, { scheme: 'https' })`).

This keeps the native parser lightweight and strictly focused on verifying standard HTTP text without needing complex URI scheme resolution.

#### Alternative Approaches Considered

During the design phase, we evaluated and rejected several other options to ensure the format remains pure and predictable:

* **Absolute URIs (`GET https://api.example.com/v1 HTTP/1.1`):** While technically permitted by RFC 9110/9112 (mostly for proxies), it clutters the request line and makes the required `Host` header partially redundant.
* **Port Inference from `Host`:** Guessing the scheme based on the port (e.g., assuming `:443` means `https`) is brittle. It forces the executor to default to `https` when omitted, and breaks entirely if an API runs HTTPS on a non-standard port like `8443`.
* **YAML Frontmatter:** Injecting a metadata block at the top of the file was discarded because it breaks the "it's just a raw HTTP string" philosophy and complicates the parsing processing workflow.

### Design Note: Line Endings (\n vs \r\n)

While the official HTTP specification (RFC 9110/9112) strictly requires `CRLF` (`\r\n`) for line terminators, HTTP Template relaxes this requirement for templates.

Because the hydrated `.httpt-r` output is consumed by execution clients (e.g., `curl`, `fetch`) rather than being streamed directly to a raw TCP socket, the parser fully supports standard Unix `LF` (`\n`) line endings. This allows developers to write and format `.httpt` files naturally in any modern text editor, relying on the underlying HTTP client to enforce standard wire-level formatting during execution. If direct socket execution is supported in the future, the **Emit Stage** can be updated to normalize line endings automatically.

### Design Note: Source Mapping Trade-off

Because we hydrate before parsing, native parser verification errors will point to character indices in the hydrated `.httpt-r` string rather than the original `.httpt` template.

To solve this without bloating the parser, the *Hydrate Stage* emits a dedicated **Index Shift Map** as a sidecar artifact. This JSON file acts as a stateless, highly queryable source map for the downstream execution engine.

#### The Index Shift Map

By explicitly storing both the start index and the length of every substitution, the map is mathematically redundant but allows the error handler to instantly reverse-map native parser errors without tracking state or calculating cumulative deltas.

```json
{
  "schema-version": "1.0",
  "substitutions": [
    {
      "original-start": 42,       // Where the {{ tag }} started
      "original-length": 15,      // The length of the {{ tag }}
      "hydrated-start": 42,       // Where the injected string starts
      "hydrated-length": 81       // The length of the injected string
    }
  ]
}
```

When the execution engine catches a syntax error (e.g., at character 100), it can simply query this map to find the overlapping `hydrated_start` and `hydrated_length` bounds, instantly tracing the failure back to the exact `original_start` block in the developer's `.httpt` file.

# VIII. Future Explorations

## Future Explorations

### Future Enhancement: Pseudo-Headers

To eventually allow templates to be self-contained without relying on external configuration, HTTP Template plans to support HTTP/2-style **pseudo-headers**.

```http
GET /api/v1/search HTTP/1.1
:scheme: https
Host: api.example.com
```

This acts as a "bogus" header within the template. The *Execute Stage* will read the pseudo-header, configure the transport layer accordingly, and then strip it out completely before handing the final sanitized payload to the underlying client.

**Implementation Requirements:**
* **Parser Rules:** The native parser's header-splitting logic will need to intentionally relax the strict RFC token definitions to allow a leading colon (`:`) for the first few lines, effectively creating a hybrid HTTP/1.1 and HTTP/2 parsing model.
* **Strict Ordering:** The parser (or the Execute Stage) must enforce the rule that all pseudo-headers must appear *before* any regular headers.
* **Execution Stripping:** The Execute Stage must extract these pseudo-headers to configure the transport layer, and then completely strip them from the final header map before handing the payload off to underlying clients (like `fetch` or `curl`) to prevent `TypeError`s.

### Future Exploration: Response Templating

While HTTP Template is currently designed around HTTP requests, the underlying RFC 9112 structure for HTTP responses is nearly identical (differing only by replacing the Request-Line with a Status-Line).

Expanding HTTP Template to template responses unlocks two powerful workflows:

Mocking: Standing up local mock servers that serve hydrated .httpt response templates.
Asserting: Firing a real request and verifying the server's output against a .httpt response template during integration testing.
Because the Hydrate Stage is agnostic to whether it is processing a request or a response, supporting this requires minimal processing workflow changes:

Parser State: The native parser's Request Line evaluation must branch at the root to accept either a Request-Line or a Status-Line.
IR Schema: The Intermediate Representation (IR) JSON must introduce a root type field (e.g., "type": "request" | "response") so the downstream Execute Stage knows how to interpret the payload.

## Roadmap & Contributing

HTTP Template is currently in active incubation. The overarching goal is to build out the parsing and execution processing workflow so that `.httpt-ir` files can eventually be executed by any underlying HTTP client (like `fetch`, `curl`, or Dart's `HttpClient`).

If you are interested in building out execution clients, contributing to the native parser, or writing static analysis tooling, please refer to the schemas defined in this document.
