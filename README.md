# El Lorito Restaurant Management System

Staff app for **El Lorito Mexican Restaurant**: seating, table status, chips service, waiter
assignments, food tickets, and ticket printing, shared live across the restaurant's devices.

Built with Next.js (App Router), TypeScript, Tailwind CSS, and Supabase (PostgreSQL + Auth).
Hosted on Vercel.

> **Status: all 12 phases built; ready to deploy.** Follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**
> (Supabase settings, first administrator, Vercel, first-day checks). History of each phase:
> [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

## What works now

- Every page requires an administrator username and password. There is no sign-up page.
- Home page with **Floor Management** and **Waiter Section**, plus a **Management** link.
- **Floor Management**: all 45 tables placed like the restaurant's floor plan. Suggests tables by
  the rotation and party size, seats by tap (including joined tables), marks chips served with one tap
  (with Undo), asks "Is the table cleaned?" to clear, and opens or closes sections.
- **Management**: start and finish shifts (waiters can only enter during a shift), set each shift's seating rotation, assign each section's waiter and
  chips runner, manage employees and sign-in accounts, and read or print a Shift Report of what a shift took. The floor shows who works each section.
- **Waiter Section**: a waiter types their employee number on a big number pad, chooses any section, and taps a
  table in its list to go straight to the order page. Built for phones and tablets. It is separate from the Floor:
  it never asks whether a table is vacant or how many guests there are. A printed customer receipt resets the table.
- **Menu**: all 206 items from the restaurant's menu (plus 4 cheese-dip add-ons) in 26 categories,
  with search, quantities, and a running order. Lunch items cost $1.00 more from 3:00 PM. Management
  can change prices and turn items off.
- **Tickets**: each group has one numbered ticket (from #1001) with any number of orders on it, including
  custom items and notes. Orders can change until the customer receipt is confirmed, and keep their prices even
  if the menu changes.
- **Printing**: **Print Kitchen Receipt** saves and prints only the new orders, large and bold, with no prices.
  **Print Customer Receipt** prints the whole bill, then asks whether it printed: Yes finalizes the ticket for
  good, No offers **Print again**. A finalized receipt can be printed again any number of times.
- **Order History**: under Management, every ticket by shift and waiter, with its saved total.
  See the [kitchen receipt](docs/screenshots/receipt-kitchen.png) and the
  [customer receipt](docs/screenshots/receipt-customer.png).
- **Live updates**: when a table, ticket, assignment, or menu item changes on one device, every
  other screen showing it updates by itself, usually within a second. A small dot under each page
  title says **Live**, **Reconnecting** (then it checks every few seconds), or **Offline**.
- `/api/health` reports whether the app is configured (never the settings themselves).

## Local setup

You need Node.js 22 (22.18 or newer), Git, and Docker Desktop (Supabase runs locally in Docker).

```bash
npm install
npx supabase start          # local Postgres, Auth, API, and Realtime; prints the URL and keys
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/ensure-realtime-policy.sql
cp .env.example .env.local  # then paste the local URL, publishable key, and secret key into .env.local
npm run admin:create        # creates your first administrator (asks for username and password)
npm run dev                 # open http://localhost:3000 and sign in
```

To put the app online, follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) instead.

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
| `bash scripts/db-race-test.sh <local db url>` | Two devices changing the same thing at once (local database only) |
| `npm run e2e` | Browser tests (Playwright): needs `npx supabase start`, then `npm run build`. Local Supabase only |
| `npm run check` | Lint, types, tests, and build together |
| `npm run admin:create` | Create an administrator account |

## Security in one paragraph

Browsers only ever hold the low-privilege publishable key. All data access happens on the server.
The secret key lives in server-only modules (`server-only` makes the build fail if browser code
imports them), and a post-build scan checks that it never reaches browser files. Every database
table has Row Level Security on with no browser policies, and browsers have no rights on any table
or function. Live updates use a private channel that only active accounts can hear, carrying no
data. Passwords are stored only as hashes by Supabase Auth. A Content Security Policy keeps pages
talking only to the app and its Supabase project. Full review, including the limits accepted for
this version (employee numbers are not passwords): [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

- [Project requirements](docs/PROJECT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Business rules](docs/BUSINESS_RULES.md)
- [Database design](docs/DATABASE_DESIGN.md)
- [Development roadmap](docs/DEVELOPMENT_ROADMAP.md)
- [Testing](docs/TESTING.md)
- [Deployment](docs/DEPLOYMENT.md) (step-by-step guide)
- [Security review](docs/SECURITY.md)
