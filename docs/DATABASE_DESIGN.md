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

### Seating (Phase 3, `20261027050000_seating.sql`)

| Table | Purpose | Key rules |
| --- | --- | --- |
| `rotation_state` | The next section in the rotation (one row) | Starts at A |
| `customer_visits` | One group from seating until the table is cleared | `guest_count` 1–100; `chips_status` needed / served (separate from occupancy); `cleared_at` set = closed; can't be cleared before chips; `version` raised on every change; who seated, served, and cleared |
| `visit_tables` | Which tables a visit occupies (several = joined tables) | **Unique open row per table**: the database itself refuses to seat two groups at one table |
| `audit_events` | History of seating, chips, clearing, section open/close | Append-only: a trigger refuses edits and deletes |

IDs for these tables are `bigint` identity numbers (they grow every shift), per Supabase guidance.

**Database functions** (each one transaction; only the server role may call them; browsers refused):

| Function | Does | Refuses with |
| --- | --- | --- |
| `seat_party(table codes, guests, actor, combination?)` | Locks the tables in a fixed order (no deadlocks), checks them, creates the visit, moves the rotation, records it | `invalid_guest_count`, `duplicate_tables`, `table_not_found`, `table_inactive`, `section_closed`, `table_occupied`, `combination_mismatch` |
| `mark_chips_served(visit, version, actor)` | Yellow → red | `stale_visit`, `visit_closed`, `chips_already_served` |
| `clear_visit(visit, version, actor)` | Red → green; closes the visit and frees its tables; keeps everything | `chips_not_served`, `stale_visit`, `visit_closed` |
| `set_section_open(section, open?, actor)` | Opens or closes a section; records it | `section_not_found` |

The app turns each refusal into plain words (`src/features/seating/errors.ts`).

### Staff (Phase 4, `20261027060000_staff.sql`)

| Table | Purpose | Key rules |
| --- | --- | --- |
| `employee_roles` | waiter, chips_runner, manager | Fixed list |
| `employees` | Staff and their numbers | `employee_number` 1–6 digits, unique; `number_key` (number without leading zeros) also unique, so 01 and 1 can't both exist; turned off, never deleted |
| `shifts` | One shift at a time | Unique index allows only one open shift |
| `shift_assignments` | Who works which section, as waiter or chips runner | One active waiter and one active runner per section per shift (unique index); rows are ended, never deleted |
| `current_assignments` (view) | Open shift's current assignments with names | Used by the floor screen and the Waiter Section |

| Function | Does | Refuses with |
| --- | --- | --- |
| `start_shift(actor)` | Ends the open shift and its assignments, opens a new one | — |
| `assign_duty(section, duty, employee or null, actor)` | Sets or clears a section's waiter or runner; keeps history | `no_open_shift`, `bar_open_to_all`, `employee_inactive`, `role_mismatch`, `employee_not_found` |
| `add_employee(number, name, role, actor)` | Adds an employee | `employee_number_taken` |
| `update_employee(id, name, role, active, actor)` | Renames, changes role, turns on/off; ends duties that no longer fit | `employee_not_found` |

Sign-in accounts use Supabase Auth's admin API from the server, then `app_users`. Audit history
now also records shift starts, assignment changes, employee changes, and account changes (never
passwords).

### Menu and tax (Phase 6, `20261027070000_menu.sql`)

| Table | Purpose | Key rules |
| --- | --- | --- |
| `tax_groups` | Food 850, Liquor 1050 (basis points: 850 = 8.5%) | Rate 0–10000 |
| `tax_categories` | food, nonalcoholic → Food; beer, cocktail → Liquor | Each points at one group |
| `menu_categories` | 26 categories in menu order, with an optional note | `late_from` + `late_surcharge_cents` together or not at all (Lunch: 15:00, 100) |
| `menu_items` | 210 items: name, description, `price_cents`, tax category, `is_available`, order | Price 0–1,000,000 cents; name unique within a category; turned off, never deleted |

| Function | Does | Refuses with |
| --- | --- | --- |
| `update_menu_item(item, price cents, available, actor)` | Changes the current price and/or on/off; records it; returns the name | `menu_item_not_found` |

### Tickets (Phase 7, `20261027080000_tickets.sql`)

| Table | Purpose | Key rules |
| --- | --- | --- |
| `tickets` | One saved order: `ticket_number` (from 1001), visit, waiter who made it, status, version | Status `open`, `printed` (needs `printed_at`), or `cancelled` (needs `cancelled_at`); never deleted |
| `ticket_lines` | Items on a ticket in the order shown | Name, `unit_price_cents`, `late_surcharge_cents`, tax category and group copied; quantity 1–99; one line per item |

| Function | Does | Refuses with |
| --- | --- | --- |
| `save_ticket(visit, ticket or null, version, employee, lines, time zone, actor)` | Creates a ticket or replaces an open ticket's lines; prices new items (with the 3 PM lunch amount); keeps saved lines' prices; records before/after | `empty_ticket`, `invalid_lines`, `employee_inactive`, `visit_closed`, `ticket_printed`, `ticket_cancelled`, `stale_ticket`, `menu_item_not_found`, `item_unavailable` |
| `cancel_ticket(visit, ticket, version, employee, actor)` | Marks an open ticket cancelled; records it | `visit_closed`, `ticket_printed`, `ticket_cancelled`, `stale_ticket` |

The visit row is locked `for share` while a ticket is saved, so clearing the table and saving a
ticket happen one after the other, never half-and-half.

### Tax and totals (Phase 8, `20261027090000_ticket_totals.sql`)

| Object | Does |
| --- | --- |
| `tax_cents(subtotal cents, rate bp)` | One tax amount: `(subtotal × rate + 5000) / 10000`, whole cents, half a cent up; null for negative input |
| `ticket_totals` (view) | Per ticket: food and liquor subtotals, both rates, both taxes, total (at the current rates) |

`tax_groups` now accepts only `food` and `liquor`. Browsers can't read the view.

## Planned (approved design)

| Group | Tables | Phase |
| --- | --- | --- |
| Printing | bills (the printed ticket with its totals), print_attempts | 9 |

## Testing

`supabase/tests/*.test.sql` (pgTAP) runs with `npm run test:db` locally and in GitHub Actions on
every push. `scripts/db-race-test.sh` opens two real connections at once to prove two hosts can't
seat the same table, and that joining the same tables in opposite order can't deadlock.
