# Testing

| Kind | Tool | Command | Where |
| --- | --- | --- | --- |
| Unit | Vitest | `npm test` | `src/**/*.test.ts`, `tests/*.test.ts` |
| Database | pgTAP via Supabase CLI | `npm run test:db` | `supabase/tests/*.test.sql` |
| Types | TypeScript | `npm run typecheck` | |
| Lint | ESLint (Next.js rules) | `npm run lint` | |
| Secret scan | `scripts/check-no-secrets.mjs` | runs after `npm run build` | |
| CI | GitHub Actions | every push and pull request | `.github/workflows/ci.yml` |

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

## Not verified in Phase 1

- A real Supabase Auth server: the build environment could not download Supabase's Docker images,
  so sign-in was tested against a stand-in. Verify locally with `npx supabase start` and
  `npm run admin:create`; GitHub Actions runs the pgTAP tests on a real Supabase database.
