# Database design

Supabase PostgreSQL. Changes are made only through migration files in `supabase/migrations`.

## Principles

- Money in whole cents (`integer`), tax rates in basis points (`850` = 8.5%).
- Every table: primary key, foreign keys, check constraints, Row Level Security **on** with no
  browser policies. The Next.js server is the only reader and writer.
- Actions that must succeed together run inside one database function (one transaction).
- History is never deleted: tickets, visits, assignments, and audit events are kept.

## Built

### `app_users` (Phase 1, `20261027030000_app_users.sql`)

| Column | Type | Rule |
| --- | --- | --- |
| user_id | uuid, PK | References `auth.users(id)`; deleted with it |
| username | text | Unique; `^[a-z0-9][a-z0-9.-]{2,31}$` |
| display_name | text | 1–80 characters, not blank |
| is_active | boolean | Default true; false blocks sign-in |
| created_by | uuid | Administrator who created it (nullable) |
| created_at, updated_at | timestamptz | `updated_at` kept current by trigger |

No password column: Supabase Auth stores only a hash in `auth.users`.
Privileges for `anon` and `authenticated` are revoked as well as blocked by RLS.
`created_by` is indexed (added in the Phase 2 migration).

### Floor layout (Phase 2, `20261027040000_floor_layout.sql`)

The migration creates the tables **and loads the real layout** from the owner's floor drawing, so it
runs in every environment.

| Table | Purpose | Key rules |
| --- | --- | --- |
| `floor_areas` | Blocks of the floor map (A, B, C, BAR, X, P) and their place on the overall floor grid | Code A–Z only; row/column spans ≥ 1 |
| `sections` | A, B, C, X-1 "X(1)", X-2 "X(2)", P, PARTY, BAR | `kind` = dining / party / bar. Only dining sections may have a `rotation_order` (A 1, C 2, B 3, X(1) 4, X(2) 5, P 6). `is_open` for closing a section. `open_to_all_waiters` = true only for the Bar |
| `restaurant_tables` | 45 tables: A1–A6, B1–B6, C1–C6, X1–X14, P1–P5, P10, Party 1–3, Bar 1–4 | `code` and `label` unique. `capacity` 1–60 or null (Party and Bar not confirmed). One table per map cell |
| `table_combinations` | A3 + A4, B3 + B4, C3 + C4, A4 + B4, X6 + X7 + X8 | `allows_over_twelve` only on X6 + X7 + X8 |
| `table_combination_members` | Which tables make up each combination | A combination must join at least 2 tables (checked at commit) |
| `table_combination_capacity` (view) | Combined chairs = sum of member chairs | Null if any member is unknown. A3 + A4 10, B3 + B4 10, C3 + C4 10, A4 + B4 12, X6 + X7 + X8 18 |

Custom combinations made by staff on the spot are not stored here; they are a seating action
(several tables on one visit), built in Phase 3.

**Changing a capacity** needs no code change. In the Supabase SQL editor:

```sql
update public.restaurant_tables set capacity = 10 where code = 'PARTY-1';
```

## Planned (approved design)

| Group | Tables | Phase |
| --- | --- | --- |
| Seating | rotation_state | 3 |
| Visits | customer_visits (chips status separate from occupancy), visit_tables (unique open row per table blocks double seating) | 3 |
| Staff | employee_roles, employees (`employee_number` text, unique), shifts (one open at a time), shift_assignments (history kept) | 4 |
| Menu & tax | menu_categories, tax_groups (FOOD 850, LIQUOR 1050), tax_categories, menu_items (never deleted) | 6 |
| Tickets | orders (from 1001), order_items (name and price copied), bills, bill_lines, print_attempts | 7–9 |
| History | audit_events (append-only) | 3 |

Database functions (each one transaction): seat_party, mark_chips_served, clear_visit,
set_section_open, start_shift, assign_section, create_order, update_order_items, create_bill,
record_print_attempt. Full column list: Phase 0 plan.

## Testing

`supabase/tests/*.test.sql` (pgTAP) runs with `npm run test:db` locally and in GitHub Actions on
every push.
