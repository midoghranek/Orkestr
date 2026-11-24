# Orkestr — agent rules

- While working, always display a progress bar showing the percentage of work done in the current window
  (e.g. `[████████░░] 80% — <status>`), updated at least every 1 minute or whenever progress changes.
- Never claim a capability, price, completed job or media file that was not verified (see TOOL_ADAPTERS.md).
- Run `npm test` and `npm run typecheck` before committing.
- Follow the product & engineering principles in AGENTS.md (creation-first Simple mode, Studio Pro for technical
  tools, no invented content, no paid calls in tests, creative approvals stay with the user).
