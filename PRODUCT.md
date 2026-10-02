# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with TypeScript and Tailwind CSS for the web interface. PHP REST endpoints and MySQL run locally through XAMPP. The database and API must remain portable to a normal PHP/MySQL hosting environment later.

## Users

- Members who want to discover, compare, contact, and book a suitable personal trainer.
- Freelance trainers and gym-employed trainers who want to present verified qualifications, manage availability, accept booking requests, receive payouts through a connected Stripe account, communicate with clients, and track paid appointments.
- Administrators who approve trainer applications and certificates, oversee users, bookings, and reports, and reconcile gym-mode income, which is paid into the platform account.

FitConnect is not limited to one province. Geographic fields are intentionally outside the current product contract; expansion happens through trainer supply and service operations without asking users to maintain province data.

## Product Purpose

FitConnect brings trainer discovery, qualification review, scheduling, booking requests, chat, online payment, and post-session reviews into one coherent Thai-language workflow. Success means a member can confidently choose and book a trainer while a trainer can manage that booking without relying on scattered social messages and manual notes.

## Positioning

FitConnect is a trainer marketplace built around verifiable trainer credentials and real availability. Its distinguishing mechanism is the connected path from trainer verification through schedule-based booking, conversation, online payment, and member feedback.

## Operating Context

- Members commonly use the service on a phone while comparing trainers by expertise, qualifications, availability, price, and reviews.
- A member can book a single session or a monthly package of no more than 30 days.
- Trainers publish one-hour availability slots up to two months ahead and set a fixed session price; the booking keeps a snapshot of that price.
- Each booking carries a service mode: `freelance` (the trainer's own clients; Stripe Connect moves the price less the platform fee, `STRIPE_PLATFORM_FEE_PERCENT`, to the trainer's connected account) or `gym` (the payment stays in the platform account and the gym's administrators reconcile the income). A trainer offering both chooses per booking.
- Booking lifecycle, enforced in `backend/src/WorkflowRules.php`:
  1. The member requests a slot. The booking is `pending_trainer` and the slot is held; the member may still withdraw it.
  2. The trainer accepts or rejects. Rejecting needs a reason the member can read and releases the slot. Accepting keeps the member's requested training time.
  3. Accepting makes the booking `awaiting_payment` at once and tells the member, who has 10 minutes to pay online. A request whose session starts before those 10 minutes are up cannot be accepted (`WorkflowRules::acceptancePaymentDeadline`).
  4. **Payment is automatic.** The member pays on Stripe Checkout (card or PromptPay; test mode locally). A paid Checkout Session makes the booking `confirmed` at once; nobody checks a slip and administrators do not decide payments. `Handlers::applyCheckoutSession()` applies a session, reached from the member's return (`POST /v1/payments/confirm`) or from the webhook (`POST /v1/stripe/webhook`), whichever arrives first.
     - A freelance booking is a direct charge on the trainer's own Stripe account (Accounts v2, Stripe-owned risk, full Stripe Dashboard); FitConnect keeps its fee as an application fee. It can be paid only once that account's `card_payments` capability is active (finance tab → บัญชีรับเงิน). Stripe collects the trainer's identity and bank details on its own pages; FitConnect stores no PromptPay number, payment QR or bank account for trainers.
     - When the ten minutes run out, the booking becomes `expired`, the slot is released and the open Checkout Session is expired in Stripe. A payment that still lands for a booking no longer waiting for one is refunded in full automatically.
  5. After the session ends the trainer records the booking as `completed`, which closes the chat to new messages and opens the member's review.
- `payment_review` and slip files remain only for bookings paid by bank slip before Stripe; no new booking enters that state.
- The trainer may cancel any booking that is not closed (`pending_trainer`, `awaiting_payment`, `payment_review`, `confirmed`) with a reason; a paid booking is refunded in full through Stripe, reversing the trainer's transfer when there was one. The member may cancel only before paying.
- Trainer applications include supporting certificate documents in PDF form and require administrator approval. Every resubmission returns the application to `pending`.

## Capabilities and Constraints

- Guest browsing, member and trainer registration, authentication, profile management, and role-aware navigation.
- Trainer search and filtering by training type, availability, price, rating, and trainer name.
- Trainer profiles with expertise, experience, certificates, schedule, service type, and reviews.
- Booking requests, trainer acceptance, cancellation with reasons, status history, chat, online payment through Stripe Checkout with automatic confirmation and refunds, and post-training reviews.
- In-app notifications for every booking and payment transition, with optional Gmail delivery.
- Trainer workspace: a weekly calendar of availability and appointments, requests awaiting a decision, members with training history, reviews with the average score, and a finance tab with the Stripe payout account and yearly statistics.
- Administrator workspace: trainer application review, users, all bookings, finance and reports, and administrator permissions.
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
5. Describe operations honestly and name the real actor: administrators verify certificates, and Stripe confirms payments automatically.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, keyboard access, focus visibility, labels, errors, and touch targets. Status must never rely on color alone. Motion must respect reduced-motion preferences, and the Thai interface must remain readable at 200% zoom and on narrow mobile screens.
