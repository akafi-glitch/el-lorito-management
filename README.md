# El Lorito Restaurant Management System

Staff app for **El Lorito Mexican Restaurant**: seating, table status, chips service, waiter
assignments, food tickets, and ticket printing, shared live across the restaurant's devices.

Built with Next.js (App Router), TypeScript, Tailwind CSS, and Supabase (PostgreSQL + Auth).
Hosted on Vercel.

> **Status: Phase 9 of 12.** Sign-in, floor management, staff management, the Waiter Section, the
> menu, tickets with tax, and printing work. Live updates across devices come next. The rest
> arrives phase by phase. See [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

## What works now

- Every page requires an administrator username and password. There is no sign-up page.
- Home page with **Floor Management** and **Waiter Section**, plus a **Management** link.
- **Floor Management**: all 45 tables placed like the restaurant's floor plan. Suggests tables by
  the rotation and party size, seats by tap (including joined tables), marks chips served, asks "Is
  the table cleaned?" to clear, and opens or closes sections.
- **Management**: start shifts, assign each section's waiter and chips runner, manage employees and
  sign-in accounts. The floor shows who works each section.
- **Waiter Section**: a waiter types their employee number on a big number pad and sees their
  sections' tables plus the Bar. Other sections can be opened after a warning that names the
  assigned waiter. Choosing a table opens the menu.
- **Menu**: all 206 items from the restaurant's menu (plus 4 cheese-dip add-ons) in 26 categories,
  with search, quantities, and a running order. Lunch items cost $1.00 more from 3:00 PM. Management
  can change prices and turn items off.
- **Tickets**: the order is saved as a numbered ticket (from #1001) for the seated group, can be
  changed or cancelled until printed, and keeps its prices even if the menu changes. Each ticket
  shows food and liquor subtotals, food tax (8.5%), liquor tax (10.5%), and the total.
- **Printing**: **Print ticket** (or **Save and print**) saves, locks the ticket, opens the browser's
  print dialog with a thermal-receipt layout, then asks "Did it print?". Yes returns to the home
  page; No offers **Print again**. Printed tickets can be printed again any number of times.
  See [a sample receipt](docs/receipt-sample.png).
- `/api/health` reports whether the app is configured (never the settings themselves).

## Local setup

You need Node.js 22.18 or newer, Git, and Docker Desktop (Supabase runs its local database in Docker).

```bash
npm install
npx supabase start          # starts local Postgres + Auth; prints the URL and keys
cp .env.example .env.local  # then paste the URL, publishable key, and secret key into .env.local
npx supabase db reset       # applies all migrations to the local database
npm run admin:create        # creates your first administrator (asks for username and password)
npm run dev                 # open http://localhost:3000 and sign in
```

`npx supabase start` prints keys labelled **Publishable** (`sb_publishable_…`) and **Secret**
(`sb_secret_…`). The secret key goes only in `SUPABASE_SECRET_KEY`, never in a `NEXT_PUBLIC_` variable.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for development |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build, then a scan that fails if a secret key reached browser files |
| `npm run test:db` | Database tests (pgTAP), needs `npx supabase start` |
| `bash scripts/db-race-test.sh <local db url>` | Two hosts seating the same table at once (local database only) |
| `npm run check` | Lint, types, tests, and build together |
| `npm run admin:create` | Create an administrator account |

## Security in one paragraph

Browsers only ever hold the low-privilege publishable key. All data access happens on the server.
The secret key lives in server-only modules (`server-only` makes the build fail if browser code
imports them), and a post-build scan checks that it never reaches browser files. Every database
table has Row Level Security on with no browser policies. Passwords are stored only as hashes by
Supabase Auth. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [Project requirements](docs/PROJECT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Business rules](docs/BUSINESS_RULES.md)
- [Database design](docs/DATABASE_DESIGN.md)
- [Development roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [Testing](docs/TESTING.md)
- [Deployment](docs/DEPLOYMENT.md)
