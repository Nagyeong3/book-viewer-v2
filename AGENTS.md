# AGENTS.md

## Mission
Build V2 from this repository's architecture. Legacy code is reference-only; do not copy its structure blindly.

## Required workflow for every change
1. Read `ARCHITECTURE.md` and the relevant phase in `ROADMAP.md`.
2. State the smallest implementation plan.
3. Implement only that scope.
4. Run the smallest meaningful automated checks plus relevant tests.
5. Review the diff for secrets, hard-coded environment values, dead code, and architecture violations.
6. Commit only when checks pass.

## Architecture rules
- Dependency direction: API -> application -> domain ports <- infrastructure.
- API handlers do not call PostgreSQL/Elasticsearch/LiteLLM directly.
- Domain code does not import framework/vendor SDK types.
- Use provider/repository interfaces for external systems.
- `invoke` and `stream` are distinct contracts.
- Normalize provider response types at adapter boundaries.
- PostgreSQL is source of truth; Elasticsearch is rebuildable search state.
- Search scope is explicit. Never silently drop `document_ids` filters.

## Coding rules
- No IP addresses, credentials, virtual keys, passwords, or model endpoints in source.
- `.env` is never committed; update `.env.example` when configuration changes.
- Avoid global mutable state.
- Use structured logging, not ad-hoc `print` in production paths.
- Do not swallow `Exception` without converting/logging it deliberately.
- No magic ranking constants inside query code; name/configure them.
- Add dependencies only when justified and suitable for offline packaging.
- Prefer simple explicit orchestration over deeply nested LangChain runnable graphs.

## Testing rules
At minimum, core changes must have unit tests. External adapters need contract/integration tests where practical. A phase is not complete because it merely starts locally.

## Git rules
- `main` represents user-validated checkpoints.
- Work on `work/phase-*` branches.
- Keep commits focused and readable.
- Never force-update `main`.
