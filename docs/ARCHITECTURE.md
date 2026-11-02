# Architecture

## The short version

The app is **server-first**. Pages load data on the server. Every change is a Server Action that
validates input with Zod and calls one database function. The database enforces the rules that
protect data, so a bug in a screen still can't break the data. Screens show a tap's result at once and
reload in the background (see "Fast responses").

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
reloads its data in the background.

## Design

Light green, after the parrot in the logo, with a Talavera-style tile pattern. The table-status
colors (green, yellow, red, gray) always come with a text label. System fonts only (no download at build or load). Touch targets
are at least 48 px. Layouts are checked at phone (390 px), tablet (820 px), and desktop (1366 px) widths.

## Waiter Section flow

The employee number travels in the link (`/waiter/01`, `/waiter/01/tables/B3`) rather than in a
cookie. Nothing is remembered between waiters on a shared tablet, and "Not you? Change number" or
Home starts over. Every page checks the number again on the server (unknown or turned-off numbers
are refused), so a stale link stops working as soon as someone is turned off. Any waiter can open any
table: choose a section, then tap a table in its list. The table's page never loads the Floor: orders belong to
tables, not to seated groups. The number identifies the waiter; the administrator sign-in is
what protects the app. Pure rules live in `features/waiter/rules.ts` and are unit tested.

## Menu and money

The menu (about 210 items) is read once per menu version and searched on the device, so typing in the
search box makes no requests. Money is whole cents end to end
(`features/menu/money.ts`); dollars appear only on screen and in the Management price box, which is
read as text, not as a floating-point number. Lunch's 3:00 PM price comes from data on the Lunch
category and the restaurant's time zone (`APP_TIME_ZONE`), so a tablet set to another time zone
still shows the right price.

## Tickets

A table's page shows the group's one ticket with its orders, and the new order being built. That order stays
on the device until **Save Order**; the server action checks the signed-in account and the waiter's number, then
calls `save_order`, which sets every menu price in the database (the device's prices are only a preview). Each
order carries a key, so a repeated press saves once. Changes to saved lines carry the ticket's version: a change
based on an older version is refused and the page reloads the newer one, so two tablets can never silently
overwrite each other.

## Printing

Browser printing, no printer driver code: the receipt is a small block placed directly under
`<body>` that is hidden on screen; in print mode `globals.css` hides everything else and an
`@page` rule sets the paper width. The order is always: the server records the attempt in the
database, the receipt is built from what the database stored, then `window.print()` opens the dialog, then
the waiter answers "Did it print?". Only a Yes to a customer receipt finalizes the ticket, in the database, using
that attempt's stored bill. The print actions don't refresh the page, so the question stays on screen; the page
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
   question. The new order on screen is the device's own, so a refresh never touches it.

## Fast responses

A tap must answer at once, however long the network takes. The causes of the old delay, and what replaced them:

- **Actions no longer re-render the page.** `revalidatePath` inside a Server Action made its answer wait
  for the whole screen to be rebuilt, and Next.js runs one action at a time per device, so taps queued up
  behind each other. Actions now answer as soon as the database has, and the screen reloads in the background.
- **The floor shows a tap immediately** (`features/floor/optimistic.ts`): chips, undo, clearing, and seating
  appear in about 10 to 40 ms, and only the table being changed is busy, not the whole floor. The server's floor
  takes over once it shows the change, and a refused change goes back with a message. Saved quantities on a
  ticket work the same way, sent in order.
- **One reload, not two.** An action's own refresh and its live signal used to both reload the screen. Refreshes
  now go through `LiveSync` (`features/sync/refresh.ts`), which runs one at a time and one more only if something
  newer arrived. So a busy restaurant doesn't stack up reloads on every device.
- **The menu isn't sent again on every reload.** About 39 KB went to every open ordering screen whenever anything
  changed anywhere. It is now fetched once per menu version from `/api/menu` and kept on the device
  (`features/menu/use-menu-data.ts`), and fetched before the waiter reaches the table.
- **Rarely changing data is cached on the server:** the floor's blocks, tables, and combinations for a minute;
  the menu per menu version. What changes during service (who is seated, sections, the rotation) is always read live.
- **One database client** per server instance, instead of a new one for each read.
- **Phones don't wait for a double-tap zoom** (`touch-action: manipulation`), and buttons react to the press.

Vercel and Supabase are both in us-east, so distance isn't the cause. What remains is a serverless cold start
(about 1.4 s measured on the first request after a quiet period), which a tap on the floor no longer waits for.

## Security headers

`next.config.ts` sends the headers from `src/config/security-headers.ts` on every response: a
Content Security Policy (only the app and its Supabase project; inline scripts and styles allowed
because Next.js needs them; no `eval` except in development), no framing, `nosniff`, same-origin
referrer, a restrictive permissions policy, and HSTS on Vercel. Zod runs in jitless mode
(`src/lib/zod-config.ts`) so validation never needs `eval` in the browser.

