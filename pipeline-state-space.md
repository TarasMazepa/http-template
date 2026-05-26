# Pipeline State Space (Input Vectors)

## Overview
To guarantee deterministic parsing, the HTTP Template pipeline's state machine is bounded by a strict set of functional inputs. These 'Input Vectors' define the exact permutations of arguments that the `hydrate` and `parse` stages can evaluate.

## Purpose
This document serves as the definitive contract for both the engine's internal logic and the End-to-End coverage matrix. By defining these states explicitly, we ensure that:
1. **Determinism:** The pipeline behaves predictably for all allowed input combinations.
2. **Contract Verification:** Our test suite can formally map every test fixture to a specific functional input state.
3. **Future-Proofing:** As we add complexity (e.g., multipart support, streaming response parsing), we can extend this state space without polluting the core specifications.

## State Dictionary

### 1. The Hydrate Stage Vectors

**`hydrate-template` (Syntax & Transformation State)**
* `Standard`: Single function injections (e.g., `| raw`, `| url`).
* `Chained`: Multiple piped functions (e.g., `| json-string | url`).
* `Malformed`: Unclosed brackets, dangling pipes, or unknown functions (Triggers `TemplateSyntaxError`).
* `Type-Mismatch`: Applying stream functions to string primitives, or text functions to native streams.

**`hydrate-data` (Context Resolution State)**
* `Exact`: Data dictionary perfectly matches the template's required keys.
* `Missing-Key`: Template requires a key not present in `data` (Triggers strict runtime error to prevent silent state corruption).
* `Orphan-Stream`: A `content` index pointer in the data context exceeds the bounds of the provided `streams` array.

**`hydrate-streams` (Injection Placement State)**
* `None`: 0 streams provided or referenced.
* `Body-Safe`: Stream injected strictly after the HTTP Head double-newline boundary (Allows O(1) memory pass-through).
* `Head-Materialized`: Stream injected into the headers (Requires full RAM buffering; risks memory limit exceptions).
* `Head-Boundary-Sabotage`: Text stream injected into the headers that contains a double newline (`\n\n`), testing the parser's resilience against premature body splitting.