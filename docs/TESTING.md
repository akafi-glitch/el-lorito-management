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

## Not verified in Phase 1

- A real Supabase Auth server: the build environment could not download Supabase's Docker images,
  so sign-in was tested against a stand-in. Verify locally with `npx supabase start` and
  `npm run admin:create`; GitHub Actions runs the pgTAP tests on a real Supabase database.
