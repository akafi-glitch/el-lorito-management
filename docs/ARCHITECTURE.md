# Architecture

## The short version

The app is **server-first**. Pages load data on the server. Every change is a Server Action that
validates input with Zod and calls one database function. The database enforces the rules that
protect data, so a bug in a screen still can't break the data.

```
Restaurant devices ──calls──▶ Next.js on Vercel ──RPC──▶ Supabase Postgres
 (publishable key only)        (secret key stays here)     (RLS, constraints, functions)
        ▲                                                         │ trigger
        └──── "something changed" signal ◀── Supabase Realtime ◀──┘
              (devices then re-read through the server)            (from Phase 10)
```

## Who holds which key

| Place | Key | Can do |
| --- | --- | --- |
| Browser | Publishable (`sb_publishable_…`) | Sign-in session only; later, listen for change signals |
| Next.js server | Secret (`sb_secret_…`) | Read and write data, after checking the signed-in user |

- `src/lib/supabase/admin.ts` (secret key) and `src/lib/env.ts` import `server-only`, so the build
  fails if browser code imports them.
- `scripts/check-no-secrets.mjs` runs after every build and fails if `sb_secret_` or the real secret
  value appears in any browser-facing file.
- Every table has Row Level Security on and no browser policies. Browsers are refused even when
  signed in.

## Sign-in flow

1. `src/proxy.ts` runs before every request. It refreshes the session cookie and sends anyone not
   signed in to `/sign-in` (only `/sign-in` and `/api/health` are public). It fails closed: if
   configuration is broken, protected pages still redirect.
2. `/sign-in` calls the `signIn` Server Action. The username maps to a hidden internal address
   (`<username>@staff.ellorito-management.com`) because Supabase Auth signs in by email. Wrong
   username or password shows one generic message.
3. After Supabase Auth accepts the password, the server checks `app_users.is_active`. Turned-off
   accounts are signed straight back out.
4. The signed-in layout (`src/app/(app)/layout.tsx`) checks the account again on every page.
5. Every Server Action checks the account itself (`requireActiveUser`), because actions can be
   called directly, not only from the page.

Supabase Auth also limits sign-in attempts per IP address (`[auth.rate_limit]` in `supabase/config.toml`).

## Folder structure

```
src/
  app/                    routes (thin: load data, render features)
    (app)/                signed-in pages: home, floor, waiter, manage
                          waiter/[number]/tables/[code]: a waiter's tables, then one table
    sign-in/              public sign-in page
    api/health/           public health check
  features/<module>/      one folder per module (auth, floor, seating, staff, waiter, menu, tickets, billing, printing, sync;
                          orders, billing, printing later)
    actions.ts            Server Actions
    queries.ts            server-only reads (floor: loadFloorMap)
    layout.ts / status.ts pure rules (floor: build the map, derive table color)
    components/           screen pieces for this module
    schema.ts             Zod rules for input and for rows read from the database
    *.test.ts             unit tests next to the rules
  components/             shared UI (Button, TextField, PageHeader, TopBar, Wordmark)
  config/navigation.ts    home-page destinations
  lib/
    env-schema.ts         configuration rules (testable)
    env.ts                validated server configuration (server-only)
    supabase/             session client, admin client (server-only), browser client, proxy session
  proxy.ts                request filter (Next.js 16 "proxy", formerly middleware)
supabase/
  config.toml             local Supabase settings (sign-ups off, password length 10)
  migrations/             one SQL file per schema change
  tests/                  pgTAP database tests
scripts/                  admin:create, secret scan
docs/                     these documents
```

## Floor changes from several devices

Each floor action calls one database function. The database decides: a table can hold one open
visit (unique index), tables are locked in a fixed order (no deadlocks), and every visit change
carries the version the screen saw (stale changes are refused). After any action the floor page
reloads its data. Live push updates to other screens come in Phase 10.

## Design

Cobalt and tile white, after Talavera tile, so brand colors never compete with the table-status
colors (green, yellow, red, gray). System fonts only (no download at build or load). Touch targets
are at least 48 px. Layouts are checked at phone (390 px), tablet (820 px), and desktop (1366 px) widths.

## Waiter Section flow

The employee number travels in the link (`/waiter/01`, `/waiter/01/tables/B3`) rather than in a
cookie. Nothing is remembered between waiters on a shared tablet, and "Not you? Change number" or
Home starts over. Every page checks the number again on the server (unknown or turned-off numbers
are refused), so a stale link stops working as soon as someone is turned off. Opening another
section's table needs `?continue=1`, which the warning's Continue button adds; a typed link without
it shows the warning first. The number identifies the waiter; the administrator sign-in is what
protects the app. Pure rules live in `features/waiter/rules.ts` and are unit tested.

## Menu and money

The menu (about 210 items) is read once per table page in two parallel queries and searched on the
device, so typing in the search box makes no database requests. Money is whole cents end to end
(`features/menu/money.ts`); dollars appear only on screen and in the Management price box, which is
read as text, not as a floating-point number. Lunch's 3:00 PM price comes from data on the Lunch
category and the restaurant's time zone (`APP_TIME_ZONE`), so a tablet set to another time zone
still shows the right price. The order being built is kept on the device until Phase 7 saves it.

## Tickets

The table page lists the group's tickets and opens one with `?ticket=1001` (no number means a new
ticket). The order being built stays on the device until **Save**; the server action checks the
signed-in account and the waiter's number, then calls `save_ticket`, which sets every price in
the database (the device's prices are only a preview). Each ticket has a version: a save based
on an older version is refused and the page reloads the newer one, so two tablets can never
silently overwrite each other.

## Printing

Browser printing, no printer driver code: the receipt is a small block placed directly under
`<body>` that is hidden on screen; in print mode `globals.css` hides everything else and an
`@page` rule sets the paper width. The order is always: the server records the print in the
database (locking the ticket and freezing its totals the first time), the receipt is built from
what the database stored, then `window.print()` opens the dialog, then the waiter answers "Did it
print?". The print actions don't refresh the page, so the question stays on screen; the page
refreshes when the waiter is done.

## Live updates

The browser never receives restaurant data from the database directly. Instead:

1. Every change raises a version for its topic (`floor`, `staff`, `menu`, `tickets`) and the
   database sends a tiny private Realtime signal: "floor changed, version 42".
2. Each page reads the versions **before** its data and hands them to `LiveSync`
   (`features/sync`). A signal newer than what the page shows makes the page call
   `router.refresh()`, which re-runs the server code that loads its data.
3. If the live connection is down, `LiveSync` asks `/api/changes` every 5 seconds (and on
   reconnect, focus, or back online), so nothing is missed. Reading versions first means a change
   during a page load causes one extra refresh, never a missed one.
4. Things that must not be interrupted hold refreshes (`features/sync/hold.ts`): the print
   question. The ticket editor keeps unsaved changes and shows a warning instead of overwriting them.

## Security headers

`next.config.ts` sends the headers from `src/config/security-headers.ts` on every response: a
Content Security Policy (only the app and its Supabase project; inline scripts and styles allowed
because Next.js needs them; no `eval` except in development), no framing, `nosniff`, same-origin
referrer, a restrictive permissions policy, and HSTS on Vercel. Zod runs in jitless mode
(`src/lib/zod-config.ts`) so validation never needs `eval` in the browser.

