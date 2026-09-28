---
target: หน้าการจองของฉัน
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\HP\\Documents\\Fitconnect\\components\\role-dashboard.tsx"
target_fingerprint: "sha256:1fa8ea135d3c7c7ed0c58d9d27d72f95b60480f33c83ce31cd0be67b6716a94c"
target_path: "C:\\Users\\HP\\Documents\\Fitconnect\\components\\role-dashboard.tsx"
timestamp: 2026-09-26T20-32-46Z
slug: components-role-dashboard-tsx
---
# Critique: หน้าการจองของฉัน (สมาชิก)

Method: dual-agent. Score 23/40 (Acceptable).

Heuristics: 1=2 status (countdown only in dialog), 2=3, 3=2 (next-action CTA dead; no withdraw while pending), 4=2 (3 names per status), 5=3, 6=2, 7=2 (no date sort), 8=2 (dialog repeats facts), 9=3, 10=2.

## Priority issues
- [P0] NextActionCard has no onFollow (role-dashboard.tsx:427); CTA changes hash but no dialog opens. Fix: open the named booking dialog.
- [P1] Payment countdown not where the member acts: add to card + row, first and sticky in dialog, red under 3 min, dynamic heading, distinct awaiting_payment badge.
- [P1] List mixes 45 closed with active, no date sort, 6 chips (157px on mobile), rows 187px on 375px. Default to active sorted by date, history behind ประวัติ, <=4 chips, next-step line per row, rows ~110px.
- [P2] Copy: payment-panel.tsx:119 ผู้รับผิดชอบ, ผู้ตรวจสลิป x2 -> เทรนเนอร์; one label per status.
- [P2] canCancel only for awaiting_payment (Handlers.php:3709) vs WorkflowRules allowing pending_trainer withdrawal.

## Minor
- Dialog chat/profile links 20px tall; <time aria-label> countdown; no filter result announcement; no visible h1 (nav การจองของฉัน vs title การฝึกของฉัน); DESIGN.md lines 124 and 145 stale; seed data oddities.
