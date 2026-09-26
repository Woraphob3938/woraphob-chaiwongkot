# Trainer slot deletion confirmation plan

**Goal:** Prevent an approved trainer from deleting a future available slot by mistake.

**Scope audit:** The admin review queue already has specific loading, empty, error, retry, validation, busy, conflict, and success states. Keep it unchanged. Add one shadcn confirmation Dialog to the existing trainer slot action; do not change API or schedule rules.

- [x] Add and observe a failing interaction test.
- [x] Confirm the selected date and time before sending `DELETE`.
- [x] Preserve focus, errors, refresh, and existing responsive behavior.
- [x] Run full verification and commit.
