# Development roadmap

Each phase ends with your approval. Every phase runs lint, type check, unit tests, database tests,
and the production build, and updates these docs.

| Phase | Delivers | Status |
| --- | --- | --- |
| 0 | Architecture and database plan | Approved |
| 1 | App shell, navigation, administrator sign-in | **Done, awaiting approval** |
| 2 | Floor map from the database (sections, tables, combinations, capacities as data) | Next |
| 3 | Seating recommendations, manual and custom seating, chips, clearing, section open/close | |
| 4 | Employees, shifts, section and runner assignments, administrator accounts page | |
| 5 | Waiter number entry, assigned tables, other-section warning | |
| 6 | Menu from the database (206 items imported), search, categories | |
| 7 | Tickets saved, editable until printed | |
| 8 | Tax and ticket totals | |
| 9 | Thermal printing (browser print), reprint | |
| 10 | Live sync across devices, conflict handling | |
| 11 | End-to-end tests and fixes | |
| 12 | Deployment and security review | |

## Phase 1 record

**Objective:** a running, tested, protected app shell.

**Built:** sign-in page, sign-out, request filter (`proxy.ts`) protecting every page, account
check on every page, `app_users` table, `admin:create` script, home page with Floor Management and
Waiter Section plus a Management link, placeholder pages, not-found and error pages, loading state,
health check, secret-key build scan, CI workflow, docs.

**Database changes:** `supabase init` (sign-ups off, password length 10); migration `app_users`.

**Known limits:** see TESTING.md, "Not verified in Phase 1".
