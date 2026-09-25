## Delivery Controls (T01) agent guardrails

- Treat [plan.md](./plan.md) as authority and [work_plan.md](./work_plan.md) as task boundaries.
- Do not weaken checks to make CI pass. Findings (`exit 1`) and tool/config failures (`exit 2`) both block delivery.
- Run `npm run delivery:verify` before handing off changes. It includes runtime pins, formatting, lint, unused/duplication checks, types, delivery tests, Cypress control tests, skill provenance, and Habit Hooks.
- Habit Hooks is required (`habit-hooks`, not Husky) with `.habit-hooks\config.toml`.
- Repository Copilot reviewer instructions are in `.github\copilot-instructions.md`.
- Do not treat comment-only reviews, resolved threads, or approvals on an old commit as Copilot approval.
- Local passes do not prove GitHub enforcement, live skill activation, real-backend behavior, or production readiness.
- Use Cypress AI Skills only. Vendor references do not authorize Cypress Cloud AI, `cy.prompt`, runtime self-healing, or uploading private data.
- Preserve vendored skill text except for its declared newline normalization. Verify its pinned checksums and license; do not apply house formatting or whitespace cleanup to upstream content.
- Only the integration lead performs authorized Git/PR operations. New worktrees, infrastructure, merges, and production release require their applicable explicit approvals.
- Keep collector/app implementation out of scope until G2/G3 authorization.

## Learnings

- Delegate routine PR-comment fixes and CI diagnosis to the designated Codex/DeepInfra lanes. The integration lead coordinates scope and approvals and verifies handoffs without repeating the full investigation; reserve higher-cost reasoning for genuinely complex decisions.
- Negative control tests must exercise the policy CI actually uses: adding `--threshold 0` only in a JSCPD test does not enforce an unconfigured root command. Require evidence of the intended violation; a missing executable is not a passing negative test. Test malformed nested report collections and exact skill allowlists, not just missing required entries.
- A check name, GitHub Actions app identity, or checkout of `main` does not pin a PR-controlled workflow definition. Qualify required-workflow availability for the repository's ownership and plan, or use a separately trusted controller; never claim enforcement from local gate tests alone.
