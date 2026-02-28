# Fundly API — Backend Assessment

## Getting Started

**Requirements:** Node 20+, Docker + Docker Compose

```bash
# Option A — Docker (recommended)
docker compose up --build      # start API + Postgres
make seed                      # create tables and seed test data

# Option B — Local
cp .env.example .env
npm install
# (start your own Postgres and update DATABASE_URL in .env)
node src/db/seed.js
npm run dev
```

The API runs at **http://localhost:3000**

Import `docs/fundly.postman_collection.json` into Postman to explore the endpoints.

**Test accounts** (after seeding):

| Email             | Password    |
| ----------------- | ----------- |
| alice@example.com | password123 |
| bob@example.com   | password123 |
| carol@example.com | password123 |

```bash
# Run the test suite
npm test
```

---

## Codebase Overview

```
src/
├── index.js              ← Express app entry point
├── db/
│   ├── pool.js           ← PostgreSQL connection pool
│   ├── migrate.js        ← Schema definition
│   └── seed.js           ← Test data
├── middleware/
│   └── auth.js           ← JWT authentication middleware
└── routes/
    ├── auth.js           ← Register / login
    ├── campaigns.js      ← Campaign CRUD + status transitions
    └── pledges.js        ← Pledging and cancellations

tests/
├── helpers.js            ← Test utilities
├── campaigns.test.js
└── pledges.test.js

docs/                     ← Worth reading
```

---

## What We'd Like From You

**Time budget:** 3–4 hours. This is scoped for a junior role we're not
expecting you to find everything, just to show us how you approach an
unfamiliar codebase.

### Deliverable 1 — `FINDINGS.md`

Write a short document covering:

- What issues you found
- How you found them
- What the real-world impact would be
- Which ones you fixed and why you prioritised those

Bullet points are fine. We care about your reasoning, not your word count.

### Deliverable 2 — Fixes

Fix the issues you're most confident about. Your fixes should not break the
existing test suite.

### Deliverable 3 — At Least One New Test

Write a test (or tests) that would have caught one of the bugs you fixed.
Add it to the existing test files.

---

## Submission

Push your work to a GitHub repo and share it with us.
Include `FINDINGS.md` at the root.

Good luck
