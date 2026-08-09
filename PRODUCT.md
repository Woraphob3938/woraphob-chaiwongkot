# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with TypeScript and Tailwind CSS for the web interface. PHP REST endpoints and MySQL run locally through XAMPP. The database and API must remain portable to a normal PHP/MySQL hosting environment later.

## Users

- Members who want to discover, compare, contact, and book a suitable personal trainer.
- Freelance trainers and gym-employed trainers who want to present verified qualifications, manage availability, accept bookings, communicate with clients, and track their work.
- Administrators who approve trainers, verify supporting documents and payments, and oversee users, bookings, and reports.

FitConnect is not limited to one province. Geographic fields are intentionally outside the current product contract; expansion happens through trainer supply and service operations without asking users to maintain province data.

## Product Purpose

FitConnect brings trainer discovery, qualification review, scheduling, booking, chat, payment evidence, and post-session reviews into one coherent Thai-language workflow. Success means a member can confidently choose and book a trainer while a trainer can manage that booking without relying on scattered social messages and manual notes.

## Positioning

FitConnect is a trainer marketplace built around verifiable trainer credentials and real availability. Its distinguishing mechanism is the connected path from trainer verification through schedule-based booking, conversation, payment review, and member feedback.

## Operating Context

- Members commonly use the service on a phone while comparing trainers by expertise, qualifications, availability, price, and reviews.
- A member can book a single day or a monthly plan of no more than 30 days.
- Trainers publish availability up to two months ahead, then accept or reject requests and confirm appointment details.
- Payments begin with a transfer slip uploaded by the member and reviewed by an administrator; the interface must not describe this as fully automatic payment processing.
- Trainer applications include supporting certificate documents in PDF form and require administrator approval.

## Capabilities and Constraints

- Guest browsing, member and trainer registration, authentication, profile management, and role-aware navigation.
- Trainer search and filtering by training type, availability, price, rating, and trainer name.
- Trainer profiles with expertise, experience, certificates, schedule, service type, and reviews.
- Booking, cancellation, status history, chat, slip upload, payment review, and post-training reviews.
- Trainer workspace for application status, profile, schedule, booking decisions, clients, reviews, and revenue summaries.
- Administrator workspace for users, trainer approvals, certificates, bookings, payments, and reports.
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
5. Describe manual operations honestly, especially certificate and payment verification.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, keyboard access, focus visibility, labels, errors, and touch targets. Status must never rely on color alone. Motion must respect reduced-motion preferences, and the Thai interface must remain readable at 200% zoom and on narrow mobile screens.
