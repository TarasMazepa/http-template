# HTTPt Test Fixtures

This directory contains language-agnostic test vectors for the `httpt` ecosystem. Because `httpt` execution sinks and parsers will eventually be implemented across multiple languages (JavaScript, Dart, etc.), we use static file pairs to ensure 100% compliance and identical behavior across all environments.

## Structure
* `*.httpt-r` - The raw, hydrated HTTP request (Resolved).
* `*.httpt-ir` - The expected Intermediate Representation (IR) JSON output after parsing.
