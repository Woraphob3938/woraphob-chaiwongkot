---
target: หน้าโปรไฟล์สมาชิกและเทรนเนอร์
total_score: 26
max_score: 40
p0_count: 0
p1_count: 2
p2_count: 3
p3_count: 1
detector_findings: 0
timestamp: 2026-08-14T17-09-26Z
slug: components-profile-workbench-tsx
---
# Profile UI critique — member and trainer

Method: dual-agent (A: `/root/profile_design_assessment` · B: `/root/profile_detector_evidence`)

## Summary

The member profile is usable and structurally sound. The trainer profile needs meaningful UI refinement before polish: the training-type checkboxes are visually broken, the page is too long on mobile, low-frequency photo actions dominate the first viewport, and users can lose unsaved edits when leaving via navigation.

## Score

Nielsen design-health score: **26/40 — acceptable, significant improvements needed**.

## Priority findings

1. **P1 — Broken trainer training-type layout.** A broad field CSS rule gives checkboxes full field sizing. Exclude checkbox/radio inputs, use compact controls, and lay choices out as a desktop grid/mobile list.
2. **P1 — Unsaved work is only guarded between tabs.** Sidebar, breadcrumb, refresh and back navigation can still discard a long trainer edit. Centralize the dirty-state guard or persist a local draft.
3. **P2 — Trainer mobile form is excessively long.** The measured page height is 3,450px at 375×812. Move photo management into a compact dialog and add section navigation or progressive disclosure.
4. **P2 — Save actions look active when nothing changed.** Disable form save until dirty and valid, and show a concise saved/unsaved state beside the action.
5. **P2 — Hidden photo input has no visible keyboard focus.** Forward `:focus-visible` styling from the visually hidden file input to its visible label.
6. **P3 — Booking-type selection is visual-only.** Add `aria-pressed` or radio semantics to the report/profile booking choice buttons.

## Strengths

- Clear Thai-first, role-aware copy and FitConnect visual identity.
- Correct tab semantics, keyboard arrow navigation, labelled controls and focus-to-error behavior.
- Loading, retry, validation, photo preview/cancel and destructive confirmation states are present.
- No horizontal overflow at 1280px or 375px; long names and certificate text wrap safely.
- Main visible controls meet the 44px touch-target baseline.

## Evidence

- Member: 1,184px document height at 1280×900; 1,780px at 375×812.
- Trainer: 2,447px document height at 1280×900; 3,450px at 375×812.
- Deterministic detector ran once against six profile TSX files and returned `[]` (0 findings). No overlay was injected because there were no detector findings.
- Browser sessions were isolated and closed; no project source was edited.

## Personas

- **Jordan (new user):** detached trainer checkbox labels and always-enabled save buttons create uncertainty.
- **Sam (keyboard/screen reader):** semantic forms are strong, but the hidden photo input lacks visible focus and booking-type selection lacks programmatic state.
- **Casey (distracted mobile user):** a 3,450px trainer form without a sticky dirty/save indicator makes interruption and accidental data loss likely.

## Recommended order

1. Repair the trainer training-type controls.
2. Add navigation/refresh protection for unsaved edits.
3. Compact photo management and shorten the trainer mobile flow.
4. Make save state explicit and fix photo-input focus visibility.

## Run notes

Target slug: `components-profile-workbench-tsx`. Ignore file was absent. Assessments were independent; Assessment A completed before Assessment B entered synthesis. Browser checks covered both roles at 1280×900 and 375×812. The deterministic detector ran exactly once and returned zero findings. No overlay was created. Sessions were cleaned up and the review made no production edits.
