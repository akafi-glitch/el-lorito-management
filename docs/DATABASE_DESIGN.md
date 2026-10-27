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

## Planned (approved design)

| Group | Tables | Phase |
| --- | --- | --- |
| Floor | sections, restaurant_tables, table_combinations, table_combination_members, rotation_state | 2–3 |
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
