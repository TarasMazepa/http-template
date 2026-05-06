## Future Exploration: Response Templating

While `httpt` is currently designed around HTTP *requests*, the underlying RFC 9112 structure for HTTP *responses* is nearly identical (differing only by replacing the Request-Line with a Status-Line).

Expanding `httpt` to template responses unlocks two powerful workflows:
1. **Mocking:** Standing up local mock servers that serve hydrated `.httpt` response templates.
2. **Asserting:** Firing a real request and validating the server's output against a `.httpt` response template during integration testing.

Because the Hydrate Stage is agnostic to whether it is processing a request or a response, supporting this requires minimal pipeline changes:
- **Grammar:** The `Httpr.g4` grammar must branch at the root to accept either a Request-Line or a Status-Line.
- **IR Schema:** The Intermediate Representation (IR) JSON must introduce a root `type` field (e.g., `"type": "request" | "response"`) so the downstream *Execute Stage* knows how to interpret the payload.
