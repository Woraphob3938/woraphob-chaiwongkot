---
target: หน้าโปรไฟล์ของสมาชิกและเทรนเนอร์
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\HP\\Documents\\Fitconnect\\components\\profile-workbench.tsx"
target_fingerprint: "sha256:8d89417c1dd38e58b0307e35028043173f0a9ffb6c007b97db5f5df23259c505"
target_path: "C:\\Users\\HP\\Documents\\Fitconnect\\components\\profile-workbench.tsx"
timestamp: 2026-09-10T13-50-23Z
slug: components-profile-workbench-tsx
---
Method: dual-agent (A: profile_design_review · B: profile_detector_retry)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Loading, errors, success, and dirty states exist, but trainer approval and the save action are buried |
| 2 | Match with the real world | 3 | Thai copy and units are natural; trainer information order does not match the readiness task |
| 3 | User control and freedom | 2 | Reset and tab confirmation exist, but leaving the route can discard edits |
| 4 | Consistency and standards | 2 | Core controls are consistent; photo and save components lack their intended styling |
| 5 | Error prevention | 2 | Field validation and delete confirmation are good; phone and unsaved-route protection remain weak |
| 6 | Recognition rather than recall | 3 | Labels and tabs are clear; trainer public/private fields are not identified locally |
| 7 | Flexibility and efficiency | 2 | Keyboard tabs work; the long trainer form has no section shortcuts or storefront preview |
| 8 | Aesthetic and minimalist design | 2 | Clean foundation, but unfinished photo/save presentation and uniform hierarchy reduce polish |
| 9 | Error recovery | 3 | Inline errors, focus-first-invalid, and retries are present; one duplicate error ID is ambiguous |
| 10 | Help and documentation | 2 | Helpful section copy exists; approval and certificate restrictions lack a clear next step |
| **Total** | | **24/40** | **Acceptable; member is stronger than trainer** |

## Design Specificity Verdict

The forest sidebar, lime active state, athletic typography, ruled sections, Thai-first copy, and verification language feel authored for FitConnect. The form body is more generic. The trainer view underuses FitConnect's trust model by placing approval and credential status after pricing, identity, and service fields.

The deterministic detector returned `[]`: zero rule findings and no false positives. Manual component inspection found a duplicate `trainer-training-types-error` ID that can make `aria-describedby` ambiguous. Browser overlay injection was unavailable because the browser evaluation surface was read-only. At 320px the inspected shell had no horizontal overflow and its primary touch targets met 44px.

## Overall Impression

The member profile has a solid, calm structure. The largest opportunity is finishing the photo/save presentation and making the trainer page answer “พร้อมรับจองหรือยัง?” before asking the trainer to edit a long form.

## What's Working

- Role-aware copy distinguishes private member data from trainer storefront data.
- Semantic tabs, labelled controls, focus-first-invalid, live status regions, image alt text, and destructive confirmation form a strong accessibility baseline.
- Loading, targeted retry, reset, and preserved form values give users practical recovery paths.

## Priority Issues

### [P1] Profile-photo interaction is visually unfinished

The avatar trigger, camera overlay, and dialog preview classes exist in the component but have no matching CSS. Add the missing selectors using current tokens, attach the camera badge to the avatar edge, and size the dialog preview for meaningful inspection.

### [P1] Save controls are not visually anchored and route changes can lose data

The forms render a save bar but its class has no CSS, so edits near the top of the trainer form require reaching the bottom to discover saving. Make the existing bar sticky only while dirty and protect sidebar/browser navigation with the existing dirty state.

### [P1] Trainer readiness and trust are buried

Approval and certificates appear after the long editable form. Place a compact readiness strip near identity, reorder public identity/service before pricing, label public versus private groups, and remove the duplicate email shown below the identity header.

### [P2] Narrow mobile navigation and identity wrapping need correction

Five long labels are forced onto one line at a 10px minimum. Use shorter mobile labels, retain at least 12px text, and give the profile email its own row at very narrow widths.

### [P2] Trainer optional complexity and one accessibility ID are exposed

Monthly package inputs are always visible and training-type errors can render the same ID twice. Reveal monthly inputs only when enabled and give loading and validation errors unique IDs.

## Persona Red Flags

- Jordan, first-time trainer: pricing appears before readiness; public/private fields and the result on the storefront are unclear.
- Sam, keyboard/screen-reader user: the long trainer tab order is costly and duplicate training-type error IDs make one description ambiguous.
- Casey, mobile user: bottom navigation labels become too small, while save controls are far from early edited fields.

## Minor Observations

- Password inputs lack show/hide controls and progressive requirement feedback.
- Trainer email repeats even though identity already displays it.
- Section descriptions are wider than comfortable reading measure on desktop.
- Training-type loading should be announced with `role="status"`.

## Questions to Consider

- Should trainer readiness be the first information on the page, ahead of price editing?
- Should monthly packages stay visible by default or appear only after opting in?
- Should the first pass fix all five issues or only the three P1 items?
