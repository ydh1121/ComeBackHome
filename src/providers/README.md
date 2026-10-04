# Provider boundary

Provider implementations live here only after their external contract is selected and verified.

Rules:
- UI never imports provider-specific response types.
- Provider responses are normalized into application/domain models first.
- Canonical transit keys are stable provider IDs, never station/stop display names.
- API secrets are never committed to client source.
- No real provider request is enabled in Phase 0/1.
