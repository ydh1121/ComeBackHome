# Provider boundary

Provider implementations live here only after their external contract is selected and verified.

Rules:
- UI never imports provider-specific response types.
- Provider responses are normalized into application/domain models first.
- Canonical transit keys are stable provider IDs, never station/stop display names.
- API secrets are never committed to client source.
- Runtime configuration selects real adapters; local verification uses isolated fixtures.
- Shared transport/recognition execution lives in `packages/portable`; product mapping, same-origin assets and quota policy stay here or in `worker/providers`.
- Existing provider paths remain compatibility adapters. See `docs/reusable-modules.md`.
