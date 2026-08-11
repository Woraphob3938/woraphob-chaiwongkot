# Server session logout implementation plan

**Goal:** Revoke the current FitConnect token on the server when a user signs out.

**Architecture:** Keep the existing 30-day database-backed bearer session. Add one authenticated logout endpoint that revokes only the presented token, then make the existing account-menu action call it before clearing local storage. Local sign-out must still finish when the API is unavailable.

**Scope:** No refresh tokens, device management, email notifications, or new account UI. Demo labels are already absent from rendered production surfaces and remain covered by existing tests; seed records stay available for local development.

- [x] Add RED browser and live API checks.
- [x] Revoke the current token through `POST /v1/auth/logout`.
- [x] Keep local sign-out reliable when the API request fails.
- [x] Verify focused, live, full, and production-build gates.
