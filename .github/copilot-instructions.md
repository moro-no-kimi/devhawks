# Copilot reviewer gate instructions

Review for human-readable source and enforceable controls:

- Confirm readability limits are still enforced (ESLint + Habit Hooks).
- Require current-head Copilot approval. Reject stale approvals.
- Do not accept comment-only reviews or resolved threads as approval evidence.
- Require required checks from the same head SHA.
- Any unknown/missing/pending/cancelled/failed review or required check keeps the gate blocked.
