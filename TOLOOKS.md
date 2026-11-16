# ToLooks

Exploratory scratchpad for backlog ideas, investigative spikes, architectural inquiries, and future refactors.

---

## Active ToLooks

- [ ] **1. Convert Stale PRs (>3 Months) Using `pr-to-tolook` Skill**
  - **Idea**: Review and convert open pull requests older than 3 months into structured ToLooks in `TOLOOKS.md` using the `pr-to-tolook` skill, then cleanly close the stale PRs after confirmation.
  - **Context**: As of 2026-11-14, 2 open PRs in `http-template` have been hanging for more than 3 months (created before 2026-08-14), adding noise to health audits and accumulating merge drift.
  - **Investigation**:
    - [ ] [#81](https://github.com/TarasMazepa/http-template/pull/81) [2026-07-26] *feat(js): add hydrate() — self-contained, matches the SDK contract* — inspect diff/comments, distill into a ToLook entry in `TOLOOKS.md`, and close PR once captured.
    - [ ] [#77](https://github.com/TarasMazepa/http-template/pull/77) [2026-07-06] *hydrate stream shape* — inspect diff/comments, distill into a ToLook entry in `TOLOOKS.md`, and close PR once captured.

---

- [ ] **2. Migrate Non-Kebab-Case Markdown Files to `kebab-case`**
  - **Idea**: Rename remaining uppercase/underscore markdown files to pure `kebab-case` per `agents.md` and update any internal or workflow references to them.
  - **Context**: `repository-seed` standardized markdown naming to pure `kebab-case` (`agents.md`, `readme.md`, `tolooks.md`, `more-agents.md`).
  - **Investigation**:
    - [ ] Rename `README.md` → `readme.md` and update references
    - [ ] Rename `TOLOOKS.md` → `tolooks.md` and update references
    - [ ] Rename `test-fixtures/README.md` → `test-fixtures/readme.md` and update references
    - [ ] Rename `test-fixtures/e2e/README.md` → `test-fixtures/e2e/readme.md` and update references

## Resolved Architectural Decisions

*(No resolved architectural decisions recorded yet.)*

---

## Related Documentation

- [AGENTS.md](AGENTS.md) — Agent guidelines and ToLooks rules.
- [docs/seeded/tolooks/README.md](docs/seeded/tolooks/README.md) — ToLooks concept and lifecycle guide.
