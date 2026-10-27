# Testing

| Kind | Tool | Command | Where |
| --- | --- | --- | --- |
| Unit | Vitest | `npm test` | `src/**/*.test.ts`, `tests/*.test.ts` |
| Database | pgTAP via Supabase CLI | `npm run test:db` | `supabase/tests/*.test.sql` |
| Types | TypeScript | `npm run typecheck` | |
| Lint | ESLint (Next.js rules) | `npm run lint` | |
| Secret scan | `scripts/check-no-secrets.mjs` | runs after `npm run build` | |
| Race tests | two real database connections at once | `bash scripts/db-race-test.sh <local db url>` | `scripts/db-race-test.sh` |
| Browser (end-to-end) | Playwright + axe | `npm run e2e` (needs `npx supabase start` and `npm run build`) | `e2e/*.spec.ts` |
| CI | GitHub Actions | every push and pull request | `.github/workflows/ci.yml` |

## The 20 required test areas and where they are covered

| # | Requirement | Unit | Database | Browser / race |
| --- | --- | --- | --- | --- |
| 1 | Section rotation | `recommend.test.ts` | `seating.test.sql` (rotation moves) | `floor.spec.ts` (suggestions) |
| 2 | Table availability | `recommend.test.ts` | `seating.test.sql` (`table_occupied`) | race 1; `floor.spec.ts` (taken on another device) |
| 3 | Table-capacity matching | `recommend.test.ts` | `floor_layout.test.sql` (capacities) | |
| 4 | Party seating priority | `recommend.test.ts` | | `floor.spec.ts` (14 guests → Party) |
| 5 | Approved table combinations | `recommend.test.ts` | `floor_layout.test.sql`, `seating.test.sql` | `floor.spec.ts` (B3 + B4); race 2 (no deadlock) |
| 6 | Simultaneous table assignments | | `seating.test.sql` | races 1 and 2 |
| 7 | Employee lookup | `waiter.test.ts` | `staff.test.sql` (01 = 1) | `waiter.spec.ts` |
| 8 | Shift reassignment | `staff.test.ts` | `staff.test.sql` (Kafi X(1) → B, history kept) | `staff.spec.ts`, `live.spec.ts` |
| 9 | Cross-section warning | `waiter.test.ts` | | `waiter.spec.ts` (exact wording) |
| 10 | Menu search | `menu.test.ts` | | `tickets.spec.ts` |
| 11 | Order quantity calculations | `menu.test.ts`, `tickets.test.ts` | `tickets.test.sql` | `tickets.spec.ts` |
| 12 | Multiple orders per visit | | `tickets.test.sql` (#1001, #1002 on one visit) | `tickets.spec.ts` |
| 13 | Food tax | `tax.test.ts` | `ticket_totals.test.sql` | `tickets.spec.ts` ($1.60 on $18.80) |
| 14 | Liquor tax | `tax.test.ts` | `ticket_totals.test.sql` | `tickets.spec.ts` ($0.52 on $4.99) |
| 15 | Combined bill totals | `tax.test.ts` (total = four parts) | `ticket_totals.test.sql` | `tickets.spec.ts` (screen = database) |
| 16 | Order editing | `tickets.test.ts` | `tickets.test.sql` | `tickets.spec.ts`; race 3 |
| 17 | Table clearance | | `seating.test.sql`, `tickets.test.sql` | `floor.spec.ts`; race 4 |
| 18 | Historical order preservation | | `tickets.test.sql` (clearing keeps tickets; menu changes don't touch them), `printing.test.sql` (frozen totals) | `tickets.spec.ts` |
| 19 | Failed print attempts and reprints | `printing.test.ts` | `printing.test.sql` | `tickets.spec.ts` (No → Print again → Yes) |
| 20 | Multi-device state consistency | `sync.test.ts` | `live_sync.test.sql` | `live.spec.ts` (two browsers, Realtime in CI); races 3 and 4 |

Database migrations are tested on every pull request: CI applies all of them to a fresh Supabase
database and runs every database test against it.

## Phase 1 tests (48 unit tests, 10 database checks)

- **Configuration:** a valid setup is accepted; a missing URL or key is rejected and named; a secret
  key under any `NEXT_PUBLIC_` name is rejected; swapped keys are rejected; a bad time zone is
  rejected; error messages never contain key values.
- **Usernames and sign-in input:** valid and invalid usernames; trimming and lowercasing; mapping to
  the internal address; empty password rejected.
- **Redirect safety:** after sign-in, only same-site paths are allowed (`https://…`, `//…`, `/\…` go home).
- **Page protection:** signed-out visits to `/`, `/floor`, `/waiter`, `/manage` go to sign-in and
  remember the target; `/sign-in` and `/api/health` stay public; a forged cookie is not accepted;
  missing configuration still blocks pages.
- **Health check:** returns ok when configured, 503 when not, and never includes keys or the URL.
- **Navigation:** home has exactly Floor Management then Waiter Section; Management is separate.
- **Database (`app_users`):** table and primary key exist; no password column; RLS on; usernames
  unique and lowercase; browsers (`anon`, `authenticated`) refused.

## Phase 1 manual and flow checks

Run against a production build, with a stand-in for Supabase Auth (see below):
wrong password shows the generic message; correct password returns to the requested page; a
signed-in visit to `/sign-in` goes home; home → Waiter → Home works; unknown pages show "Page not
found"; sign-out returns to sign-in and blocks `/manage`; a turned-off account is refused; no
sideways scrolling on phone. Screenshots checked at 390, 820, and 1366 px widths.

The `app_users` migration and the same checks as the pgTAP file were run against a real
PostgreSQL 18 with stand-in `auth` schema and roles: all passed, including the cascade delete.

## Phase 2 tests (18 new unit tests, 31 new database checks)

- **Floor layout from the real data** (`src/features/floor/layout.test.ts`, using
  `tests/fixtures/floor-rows.json`, exported from a database after running the migrations): 45
  tables, all vacant; areas placed like the drawing; Section A order A3 A4 / A2 A5 / A1 A6; X(1) and
  X(2) together on a 5 × 3 grid; Party beside P; Bar 1–4 in a row; five combinations with summed
  chairs; closed sections turn gray; inactive tables hidden.
- **Safety checks:** two tables in one spot, an unknown section, or a combination pointing at a
  missing table each stop with a clear error.
- **Status rules:** green, gray, yellow, red, and the guest count on a seated table.
- **Database (`floor_layout.test.sql`):** every section's tables and every chair count match the
  drawing (25 four-chair, 11 six-chair, 2 two-chair, 7 unknown); every dining table has a capacity;
  rotation A, C, B, X(1), X(2), P; only the Bar is open to every waiter; combined capacities 10, 10,
  10, 12, 18; only X6 + X7 + X8 over twelve; capacity 0 refused; two tables in one spot refused;
  the Bar can't join the rotation; a one-table combination refused; capacity can be changed as data;
  every foreign key indexed; browsers refused.

**How the database tests were run locally:** real PostgreSQL 18 with pgTAP installed, Supabase-like
roles and `auth` schema, all migrations applied in order, then every file in `supabase/tests`.
41 of 41 checks passed. GitHub Actions runs the same files on a real Supabase database.

**Browser checks (production build, stand-in for Supabase Auth and API):** all 45 tiles shown with
the right chairs; counts show 45 vacant; A, B, C left to right; Bar above X; P beside Bar and X;
no sideways scrolling on phone; no browser errors. All Phase 1 sign-in and navigation checks
re-run and still pass. Screenshots checked at 390, 1024, and 1440 px widths.

## Phase 3 tests (39 new unit tests, 38 new database checks, 2 race tests)

- **Suggestions** (`src/features/seating/recommend.test.ts`, on the real layout): rotation order
  and wrap; closed sections skipped; Party and Bar never in the rotation; first suggestion in the next
  section; 4 guests get a 4-chair table, 5–6 a 6-chair table, 2 guests a 2-chair table; occupied and
  closed tables never suggested; 7+ guests get Party areas first with a "check it fits" reminder,
  then the smallest combination that fits; above 12 only X6 + X7 + X8; a combination with any taken
  table is skipped; clear messages when nothing fits; bad guest counts refused.
- **Input and messages** (`actions-support.test.ts`): seating input rules, plain-language messages
  for every database refusal, never showing raw database text, and joined tables grouped per party.
- **Database (`seating.test.sql`):** seating, double seating refused (including writing rows
  directly), closed sections refused, open again then seat, rotation A → C → … and wrap after P,
  Party and Bar don't move it, approved and hand-made combinations, bad input refused, yellow can't
  be cleared, out-of-date versions refused, chips twice refused, clearing frees the table and keeps
  the visit, a new group gets a new visit, audit recorded and can't be edited, browsers refused.
- **Two hosts at the same moment** (`scripts/db-race-test.sh`, also in GitHub Actions): two real
  connections seat A6 together, so one wins and the other is told it's taken. Two hosts join A5 + B5 in
  opposite order: one wins, and there's no deadlock.

**Browser walkthrough against the real database functions.** The local test database runs real
PostgREST (the API server Supabase uses); only sign-in is a stand-in. 24 of 24 steps passed:
suggestion → seat → yellow with guests → rotation moves → chips → red → "Is the table cleaned?" No
stays red, Yes clears; tap B3 + B4 → guest count asked → joined and recorded as the approved
combination; close C → gray → tap → "Open section C"; 14 guests → Party first with reminder; another
device takes A2 first → clear message and refresh, one visit only; another device serves chips first
→ refused, not overwritten; phone has no sideways scroll; no page errors. Phase 1 and 2 browser
checks re-run against the same database and still pass.

## Phase 4 tests (24 new unit tests, 32 new database checks)

- **Unit** (`src/features/staff/staff.test.ts`): 01 and 1 are the same number; who can take which
  duty; eligible lists exclude turned-off staff; the board shows the latest assignment; the Bar
  never gets a waiter; you can't turn off your own account and one account always stays on; input
  rules for employees, assignments, and passwords; plain-language messages.
- **Database (`staff.test.sql`):** roles; adding employees; "1" refused when "01" exists; digits
  only; assigning needs an open shift; the Kafi example (X(1) → B: latest is B, history keeps
  X(1)); one waiter per section; runners can't wait and managers can do both; the Bar takes no
  waiter; Runner 2 covers X(1), X(2), P, Party; turning someone off ends their duty and blocks new
  ones; a role change ends duties that no longer fit; a new shift starts empty; browsers refused.

**Browser walkthrough** on real PostgREST and the database functions, with a stand-in for
Supabase Auth's sign-in and admin API: 23 of 23 steps passed. Start shift; add five employees;
duplicate number refused; waiter lists show only waiters and managers; assign, move, and keep
history; runners on their sections; the floor shows each section's waiter and runner and "any
waiter" for the Bar; turning Jesus off ends his duty; add a sign-in account, set its password, turn
it off (can't sign in), turn it on (old password refused, new one works); you can't turn yourself off;
new shift asks first and clears assignments; history recorded; no page errors. Phase 1–3 walkthroughs
re-run and still pass.

## Phase 5 tests (19 new unit tests, no database changes)

- **Unit** (`src/features/waiter/waiter.test.ts`, on the real floor layout): lookup accepts active
  staff and refuses unknown and turned-off numbers; typed numbers are digits only, at most six;
  Kafi on X(1) sees X1, X2, X3, X9, X10, X11, X12, then the Bar, then the rest; a waiter on two
  sections sees both; an unassigned waiter sees everything; moving Kafi to B moves his tables; the
  warning uses the owner's exact words; no warning for your own table or the Bar; a section with no
  waiter is named; empty tables can't be opened; links and table codes are checked.

**Browser walkthrough** on real PostgREST and the database functions: 30 of 30 steps passed.
Number pad and keyboard entry; unknown, turned-off, and malformed numbers refused; "1" opens
Kafi (01) with X(1) first; guest counts on tiles; empty table refused with a reason; own table and
Bar open with no warning; Musfika's B3 asks with the exact warning, Cancel stays, Continue opens
and notes it; a typed link asks too; section C (nobody assigned) warns by section; moving Kafi to B
shows after Refresh and B3 then opens directly; an unassigned waiter is told so and sees every
section; Done returns Home; browsing writes nothing; phone layout has no sideways scroll; no page
errors.

## Phase 6 tests (28 new unit tests, 27 new database checks)

- **Unit** (`src/features/menu/menu.test.ts`, on the real menu exported from the database): 26
  categories with Lunch first; 206 menu items plus 4 add-ons; chile con queso $5.19; tax
  categories; only Lunch has late pricing; money in whole cents (0.10 + 0.20 is exactly 0.30;
  typed prices like 8.255 refused); lunch price $7.99 at 2:59 PM and $8.99 from 3:00 PM on the
  restaurant's clock whatever the device's time zone; search ("combo 5" finds Combo #5, not #15;
  accents and punctuation ignored); adding, quantities 1–99, removing, and totals.
- **Database (`menu.test.sql`):** tables; tax rates; 26 categories, 206 + 4 items; spot prices;
  every item priced and available; Lunch late pricing; 7 beers, 22 cocktails, 21 nonalcoholic
  drinks; late time without an amount, negative prices, and duplicate names refused;
  `update_menu_item` changes price and availability, records the change, refuses unknown items;
  browsers refused.

**Browser walkthrough** on real PostgREST and the database functions: 26 of 26 steps passed.
26 categories, Lunch first; tap to add; quantities with − and + (− stops at 1); search and "nothing
matches"; remove; totals; Management changes Taco to $2.50 and turns it off (recorded twice in the
audit history); the waiter sees $2.50 greyed out; with the device clock moved to 3:00 PM, Lunch #2
changes to $8.99 without reloading and is labelled; phone order bar; no sideways scroll; no page
errors. Phase 3–5 walkthroughs re-run and still pass.

## Phase 7 tests (15 new unit tests, 48 new database checks, 2 new race tests)

- **Unit** (`src/features/tickets/tickets.test.ts`): saved lines in order with totals in cents;
  maker and last editor; the after-3 PM part of a price; editing starts from the saved lines;
  unsaved changes noticed (quantity, added, removed, reordered); only open tickets on an open table
  can change; ticket links keep the other-section confirmation; input rules (no empty order, no
  repeated item, quantities 1–99, version required to change a saved ticket); plain messages.
- **Database (`tickets.test.sql`):** numbers start at 1001 and continue; copied names, prices,
  tax groups; 3:00 PM lunch price; editing keeps saved prices (after a menu change and after
  3 PM) and prices new items now; maker kept, editor recorded; stale saves refused; the history
  keeps lines before and after; empty, repeated, 0, 100, 1.5, missing, and non-list lines
  refused; unknown items, time zones, employees, visits refused; turned-off items can't be added
  but can stay; cancelling; printed tickets locked; clearing the table keeps tickets and stops
  changes; the next group starts fresh; browsers refused.
- **Race tests** (`scripts/db-race-test.sh`, also in CI): two waiters save the same ticket at once
  (the first wins, the second is told); a save arriving while the table is cleared waits, then
  is refused.

**Browser walkthrough** on real PostgREST and the database functions: 26 of 26 steps passed, twice.
New ticket #1001 saved and listed; database lines checked; change, undo, save changes; saved
price kept after a menu change, new item priced now; a second device's stale save refused and
then shown the newer ticket; ticket #1002 saved and cancelled (kept, read-only); a printed ticket
opens read-only; a just-turned-off item refused by name; saving after the table was cleared refused,
both tickets kept; the next group starts with no tickets; phone layout; no page errors. Phase 3–6
walkthroughs re-run and still pass.

## Phase 8 tests (20 new unit tests, 18 new database checks)

- **Unit** (`src/features/billing/tax.test.ts`, plus ticket totals in `tickets.test.ts`): the
  same rounding examples as the database ($7.50 → $0.64, $5.25 → $0.55, exactly half a cent rounds
  up, 1 cent has no tax, large amounts stay exact); the owner's $13.94 example; food and
  nonalcoholic drinks together, beer and cocktails together; rounding once on the subtotal, not
  per line; food-only and liquor-only tickets; total always equals its four parts; missing rates or
  categories are errors, never guesses; rates shown as 8.5% and 10.5%; the database's totals for a
  ticket equal the app's own calculation.
- **Database (`ticket_totals.test.sql`):** the same rounding examples; real tickets saved through
  `save_ticket` (mixed, food-only, liquor-only, lunch after 3 PM) with their subtotals, taxes, and
  totals; total = the four parts; rates from the tax groups; browsers refused; only food and
  liquor tax groups.

**Browser walkthrough:** 29 of 29 ticket steps passed, including the totals preview while building
($18.80 + $4.99 + $1.60 + $0.52 = $25.91), the database's total matching the screen after saving,
and a read-only printed ticket showing its taxes and total. Phase 3–6 walkthroughs re-run and
still pass.

## Phase 9 tests (9 new unit tests, 33 new database checks)

- **Unit** (`src/features/printing/printing.test.ts`, `tests/env.test.ts`): the receipt has every
  required part; waiter number only; frozen totals from the database used as they are; joined
  tables in floor order; only printed tickets accepted; paper widths 80/58 mm; request rules;
  plain messages; the paper-width setting.
- **Database (`printing.test.sql`):** printing an old version refused; reprinting an unprinted
  ticket refused; "printed" impossible without frozen totals; first print locks, records who and
  when, freezes $25.91; attempt 1 recorded as unknown; the maker kept; table not cleared; no second
  first print, no changes, no cancelling after printing; a later tax-rate change leaves the printed
  total alone while unprinted tickets use the new rate; answers stored once with who and when;
  reprints numbered 2, 3; unanswered stays unknown; cancelled tickets can't print; cleared tables
  can't print new tickets but can reprint; turned-off staff can't print; history; browsers refused.

**Browser walkthrough** (the browser's print command replaced by a counter; the receipt also saved
as an 80 mm PDF): 24 of 24 steps passed. Save and print in one tap; the question after the print
dialog; the receipt's contents (and no waiter name); locked with frozen totals; attempt recorded as
unknown; No → Print again → Yes → home page; table not cleared; reprint from the locked ticket;
closing the question leaves the answer unknown; an out-of-date screen can't print and nothing goes
to the printer; joined tables print as "X6 + X7 + X8"; history; no page errors. Phase 3–8
walkthroughs re-run and still pass.

**Still to check on the real printer** (model not chosen yet): the paper width, that the browser's
print dialog sends one receipt-length strip, and the cut.

## Phase 10 tests (17 new unit tests, 23 new database checks)

- **Unit** (`src/features/sync/sync.test.ts`): one refresh per change from another device; several
  changes close together become one refresh; other topics, old versions, and junk ignored; no
  second refresh for a change already on screen; polling every 5 seconds only while the live
  connection is down; catching up after reconnecting; working with no live connection at all;
  offline shown and recovered; checking on focus; waiting while held (print question) then
  refreshing once; stopping cleanly; holds counted.
- **Database (`live_sync.test.sql`):** each topic's version moves with its changes (seating,
  chips, sections; employees, shifts, assignments; prices; tickets, printing) and not with others;
  the signal goes privately to `restaurant` with only topic and version; a refused change sends
  nothing; a failing Realtime never blocks a change and the version still moves; only active
  accounts may listen; browsers can't read versions or send signals.

**Two-device walkthrough** (`sync-flow`, local fallback path; this workspace has no Realtime
service): 18 of 18 steps passed. Seating by another device shows within a second; chips served on
one floor turns the table red on the other; a reassignment reaches the waiter's screen; a price
change and an item turned off reach the waiter's menu; a ticket saved elsewhere appears; an open
ticket follows another device's save; with unsaved changes the waiter is warned and can show the
other version; the print question stays put while changes arrive; Management's menu follows
(search kept); offline shown, and the change made meanwhile appears when back online; no page
errors. Phase 1–9 walkthroughs re-run and pass (they now ignore the local stand-in's refused
Realtime connection; the stand-in has no Realtime service).

## Phase 11 tests (32 browser tests in the repository)

The browser walkthroughs used in earlier phases are now part of the repository (`e2e/`), and CI
runs them on every pull request against a full local Supabase (database, sign-in, API, and
**Realtime**). The tests refuse to run against anything but a local Supabase.

- `auth.spec.ts`: sign-in required (and returns you where you were going), wrong password,
  change counter needs sign-in, public health check shows no settings, home, page not found.
- `floor.spec.ts`: 45 tables and legend; suggested seating → chips → "Is the table cleaned?" →
  green; joined tables by hand (guest count asked); 14 guests → Party first; close and reopen a
  section; a table taken on another device can't be seated twice.
- `staff.spec.ts`: add employee, number can't repeat; assignments on the board, floor, and
  waiter screen; latest wins; the Bar takes no waiter.
- `waiter.spec.ts`: unknown and turned-off numbers; "1" finds "01"; own section, Bar, other
  section with the exact warning; empty tables can't open.
- `tickets.spec.ts`: categories, search, quantities, remove, taxes ($25.91); save, change, undo,
  save changes, saved price kept after a menu change, database total = screen; Save and print,
  receipt contents (waiter number only), locked, attempt recorded, No → Print again → Yes → home,
  table not cleared, reprint from the locked ticket; another device's save can't be overwritten,
  Show their version, cancel.
- `live.spec.ts`: seating on one device shows on another without reloading; a second browser
  follows the first; reassignment and menu changes reach the waiter; offline shown, changes made
  meanwhile appear. In CI the dot must say **Live**, and the update must arrive within 4 seconds
  while live (the screen doesn't poll while live, so it came over Realtime).
- `devices.spec.ts`: every working page on a phone (390 px), tablet (820 px), and computer
  (1440 px) with no sideways scrolling; floor and menu buttons at least 44 px; no serious or
  critical accessibility problems (axe, WCAG 2.1 AA) on any working page.

**Fixed because of these tests:** the floor's section open/close buttons were smaller than 44 px;
empty tables in the Waiter Section had faded text below the contrast minimum.

**Local results:** 32 of 32, twice in a row on the same database (the tests can be re-run). Local
runs here use the 5-second fallback (no Realtime in this workspace); CI checks the live path.

## Not verified in Phase 1

- A real Supabase Auth server: the build environment could not download Supabase's Docker images,
  so sign-in was tested against a stand-in. Verify locally with `npx supabase start` and
  `npm run admin:create`; GitHub Actions runs the pgTAP tests on a real Supabase database.
