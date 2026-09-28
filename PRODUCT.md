# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with TypeScript and Tailwind CSS for the web interface. PHP REST endpoints and MySQL run locally through XAMPP. The database and API must remain portable to a normal PHP/MySQL hosting environment later.

## Users

- Members who want to discover, compare, contact, and book a suitable personal trainer.
- Freelance trainers and gym-employed trainers who want to present verified qualifications, manage availability, accept booking requests, check their own members' payment slips, communicate with clients, and track paid appointments.
- Administrators who approve trainer applications and certificates, oversee users, bookings, and reports, and keep a read-only view of gym-mode payment slips for income and salary reconciliation.

FitConnect is not limited to one province. Geographic fields are intentionally outside the current product contract; expansion happens through trainer supply and service operations without asking users to maintain province data.

## Product Purpose

FitConnect brings trainer discovery, qualification review, scheduling, booking requests, chat, payment evidence, and post-session reviews into one coherent Thai-language workflow. Success means a member can confidently choose and book a trainer while a trainer can manage that booking without relying on scattered social messages and manual notes.

## Positioning

FitConnect is a trainer marketplace built around verifiable trainer credentials and real availability. Its distinguishing mechanism is the connected path from trainer verification through schedule-based booking, conversation, payment review, and member feedback.

## Operating Context

- Members commonly use the service on a phone while comparing trainers by expertise, qualifications, availability, price, and reviews.
- A member can book a single session or a monthly package of no more than 30 days.
- Trainers publish one-hour availability slots up to two months ahead and set a fixed session price; the booking keeps a snapshot of that price.
- Each booking carries a service mode: `freelance` (the trainer's own clients, paid to the trainer's account) or `gym` (the trainer works for a gym, and the gym's administrators reconcile the income). A trainer offering both chooses per booking.
- Booking lifecycle, enforced in `backend/src/WorkflowRules.php`:
  1. The member requests a slot. The booking is `pending_trainer` and the slot is held; the member may still withdraw it.
  2. The trainer accepts or rejects. Rejecting needs a reason the member can read and releases the slot. Accepting keeps the member's requested training time and picks a notification round, 12:00 or 18:00 (Asia/Bangkok). A round that would leave the member less than 10 minutes to pay before the session is refused.
  3. At that round the booking becomes `awaiting_payment` and the member has 10 minutes to upload a transfer slip.
  4. The slip puts the booking in `payment_review`. **The booked trainer checks the slip** against their banking app and approves or rejects it; administrators cannot decide slips. The interface must not describe this as automatic payment processing.
     First-line slip checks (`backend/src/SlipRules.php`) narrow what the trainer looks for but never replace finding the credit in the banking app:
     - Each booking gets an exact transfer amount: the price plus 1–99 satang not used by another open booking paid to the same account (`bookings.transfer_amount`). The member transfers that exact amount, so one credit matches one booking.
     - The browser reads the mini QR on the slip; the server accepts it only with a valid CRC and stores `bank:reference` in `payments.transaction_ref` (unique). A slip already used for any booking is refused. A slip whose QR cannot be read still uploads and is flagged for a closer check.
     - The end of the ten-minute window each slip answered is kept (`payments.window_ends_at`), and the review screen shows the window the transfer time on the slip must fall in.
  5. The first rejected slip grants one new 10-minute upload window. A second rejection, or a missed deadline, makes the booking `expired` and releases the slot.
  6. An approved slip makes the booking `confirmed`. After the session ends the trainer records it as `completed`, which closes the chat to new messages and opens the member's review.
- The trainer may cancel any booking that is not closed (`pending_trainer`, `awaiting_payment`, `payment_review`, `confirmed`) with a reason. The member may cancel only before submitting a slip, or after a slip was rejected.
- Trainer applications include supporting certificate documents in PDF form and require administrator approval. Every resubmission returns the application to `pending`.

## Capabilities and Constraints

- Guest browsing, member and trainer registration, authentication, profile management, and role-aware navigation.
- Trainer search and filtering by training type, availability, price, rating, and trainer name.
- Trainer profiles with expertise, experience, certificates, schedule, service type, and reviews.
- Booking requests, trainer acceptance, cancellation with reasons, status history, chat, slip upload, trainer slip review, and post-training reviews.
- In-app notifications for every booking and payment transition, with optional Gmail delivery.
- Trainer workspace: a weekly calendar of availability and appointments, requests awaiting a decision, the trainer's own slip queue, members with training history, reviews with the average score, and a finance tab with yearly statistics.
- Administrator workspace: trainer application review, users, all bookings, finance and reports, administrator permissions, and a read-only view of gym-mode slips.
- Thai-first responsive web interface for members, trainers, and administrators without province or appointment-location fields.
- No fabricated trainers, testimonials, customer logos, performance metrics, or payment claims may be presented as real evidence. Seed data must be clearly identified as demonstration data.

## Brand Commitments

- Product name: FitConnect.
- Thai-first product language with concise, reassuring, action-oriented copy.
- Confirmed direction: utilitarian athletic—strong, energetic, focused, and practical rather than decorative.
- Confirmed identity colors: deep forest green with a controlled lime accent. Exact accessible tokens belong in the visual system, not in this product record.

## Evidence on Hand

- Chapter 1 project document: `D:\Microsoft word งาน\Project\607948668121382947_บทที่1_6640203938 (1).pdf`.
- Chapter 3 systems and database document: `D:\Microsoft word งาน\Project\บทที่ 3.pdf`.
- The documents contain requirements, user flows, diagrams, interface references, and an initial nine-table database model.
- No approved production logo, photography, testimonials, customer logos, or audited business metrics have been supplied.

## Product Principles

1. Make trust inspectable: show qualification status, availability, pricing context, and booking status clearly.
2. Keep the booking path continuous: discovery, conversation, schedule selection, payment evidence, and review should feel like one journey.
3. Design for expansion: keep discovery and transactions independent from province data so the service can grow without changing the core workflow.
4. Give each role a focused workspace while keeping shared booking facts consistent.
5. Describe manual operations honestly and name the real actor: administrators verify certificates, the booked trainer verifies payment slips.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, keyboard access, focus visibility, labels, errors, and touch targets. Status must never rely on color alone. Motion must respect reduced-motion preferences, and the Thai interface must remain readable at 200% zoom and on narrow mobile screens.
