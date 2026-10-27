# Development roadmap

Each phase ends with your approval. Every phase runs lint, type check, unit tests, database tests,
and the production build, and updates these docs.

| Phase | Delivers | Status |
| --- | --- | --- |
| 0 | Architecture and database plan | Approved |
| 1 | App shell, navigation, administrator sign-in | Done (pull request #1) |
| 2 | Floor map from the database (sections, tables, combinations, capacities as data) | Done (pull request #2) |
| 3 | Seating recommendations, manual and custom seating, chips, clearing, section open/close | Done (pull request #3) |
| 4 | Employees, shifts, section and runner assignments, administrator accounts page | Done (pull request #4) |
| 5 | Waiter number entry, assigned tables, other-section warning | Done (pull request #5) |
| 6 | Menu from the database (206 items imported), search, categories | Done (pull request #6) |
| 7 | Tickets saved, editable until printed | **Done, awaiting approval** |
| 8 | Tax and ticket totals | Next |
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

## Phase 2 record

**Objective:** show the real restaurant floor from the database.

**Built:** migration `floor_layout` with `floor_areas`, `sections`, `restaurant_tables`,
`table_combinations`, `table_combination_members`, and the `table_combination_capacity` view, loaded
with all 45 tables from the floor drawing. Floor Management page: a map placed like the drawing
(A, B, C on top; Bar above X on the left; P and Party on the right), every tile showing its table,
chairs, and status, status counts, and the approved combinations with summed chairs. The section is
shown on tiles where one block holds two sections (X(1)/X(2), P/Party).

**Database changes:** migration `20261027040000_floor_layout.sql`. It also indexes
`app_users.created_by` and stops browser roles from calling helper functions.

**Not in this phase:** tapping tables (seating, chips, clearing) and opening or closing sections
come in Phase 3. All tables show green until then.

## Phase 3 record

**Objective:** run the floor: suggest tables, seat, serve chips, clear, open and close sections.

**Built:** migration `seating` (visits, visit tables, rotation, audit history, four database
functions). Floor screen: New party panel with up to 3 suggestions following your rules; tap free
tables to seat one or join several (guest count asked only if not entered); tap yellow for "Chips
served"; tap red for "Is the table cleaned?"; open/close buttons per section; guest counts and
joined tables on tiles; plain-language messages when another device got there first.

**Decisions applied:** tapped seating moves the rotation; closed sections can't be seated; the
chips runner clears; anyone can join tables.

**Not in this phase:** who is the waiter or chips runner (Phase 4); live updates on other screens
without a refresh (Phase 10). Until then, another device's changes appear on the next action or reload,
and the database still refuses every conflicting change.

## Phase 4 record

**Objective:** know who works where.

**Built:** migration `staff` (roles, employees, shifts, assignments with history, current-assignments
view, four database functions). Management now has three tabs: **Shift and sections** (start a shift,
pick each section's waiter and chips runner), **Employees** (add, rename, change role, turn on/off),
and **Sign-in accounts** (add, set new password, turn on/off). The floor shows each section's waiter
and chips runner.

**Decisions applied:** roles are waiter, chips runner, manager; Runner 2 covers X(1), X(2), P, Party;
the Bar has no assigned waiter.

**Not in this phase:** the Waiter Section using these assignments (Phase 5).

## Phase 5 record

**Objective:** a waiter identifies themselves and picks a table.

**Built:** the Waiter Section. A number pad (also accepts a keyboard) looks up the employee; "1"
finds "01". Unknown and turned-off numbers are refused in plain words. The waiter sees their own
sections' tables first, then the Bar, then the other sections folded away. Tiles show the table
color, guest count, and joined tables. Choosing a table shows the waiter and the table; the menu,
tickets, and printing arrive in Phases 6–9. No database changes in this phase.

**Decisions applied:** any waiter can bill the Bar with no warning; another waiter's table asks
"This table is assigned to Musfika (02). Do you want to continue?" and the waiter may continue.

**Choices made where the requirements were silent (easy to change):**
- Only a table with seated guests can be opened, because tickets belong to a customer visit and
  visits start on the Floor. An empty table says "Seat them on the Floor first."
- A table in a section with no waiter also asks first ("This table is in section C, which isn't
  assigned to you").
- Any active employee number opens the Waiter Section, including chips runners and managers
  ("everyone can access everything for now").
- A typed link to another section's table still asks before opening.

**Not in this phase:** the screen updates when assignments change after **Refresh**; automatic
live updates come in Phase 10.

## Phase 6 record

**Objective:** the menu comes from the database and a waiter can build an order.

**Built:** migration `menu` (tax groups and tax categories, menu categories, menu items, and
`update_menu_item`), loaded with the owner's menu file: 206 items in 25 categories, plus a
"Cheese dip add-ons" category. On a table, the waiter picks a category or searches, taps items to
add them, changes quantities with − and +, removes lines, and sees the running total before tax.
Management has a new **Menu** tab to change prices and turn items off or on (recorded in the
audit history).

**Decisions applied (Oct 27, 2026):** chile con queso $5.19; lunch items are served all day and
cost $1.00 more from 3:00 PM (restaurant time). Food and nonalcoholic drinks are taxed as food;
beer and cocktails (wine is on the cocktail page) as liquor.

**Choices made where the requirements were silent (easy to change):**
- The menu's cheese-dip prices are four ordinary items (lunch enchilada $1.25, lunch burrito $1.50,
  combo enchilada $1.00, combo burrito $1.25), since food modifications are out of scope.
- The category is named "Lunch" (not "Lunch Only"), because lunch is served all day.
- Turned-off items stay on the waiter's menu, greyed out, so staff can see they're unavailable.
- Item names are kept exactly as in the menu file. Management can change prices and availability;
  renaming and adding items can come later if needed.

**Not in this phase:** the order is not saved yet (Phase 7). If the waiter leaves the page, the
unsaved order is lost. The lunch price shown follows the device clock in restaurant time; from
Phase 7 the server sets the price when the ticket is saved.

## Phase 7 record

**Objective:** a waiter's order is saved as a ticket and can be changed until it is printed.

**Built:** migration `tickets` (tickets numbered from 1001, ticket lines with copied name, price,
and tax group; `save_ticket` and `cancel_ticket`). On a table, the waiter sees **Tickets for this
table** and can open any of them or start a **New ticket**. **Save ticket** stores it; **Save
changes** updates it; **Undo changes** goes back to what's saved; **Cancel this ticket** cancels
an unprinted ticket (kept in the history). Printed and cancelled tickets open read-only.

**Decisions applied:** editable until printed; printing locks for good (Phase 9); any number of
tickets per group; names and prices copied onto the ticket; lunch is $1.00 more from 3:00 PM.

**Choices made where the requirements were silent (easy to change):**
- The database sets each price when the item is first saved on the ticket. A line keeps that
  price when the quantity changes later, even after 3:00 PM or a menu price change.
- Another waiter may change an open ticket; the ticket keeps the waiter who made it and records
  who changed it last.
- An unprinted ticket made by mistake can be cancelled (it stays in the history, marked cancelled).
- When two devices change the same ticket, the first save wins and the second is told to redo
  its change on the newer version.

**Not in this phase:** tax and totals (Phase 8); printing and locking (Phase 9). Moving to another
ticket on the same page discards unsaved changes without asking; leaving or reloading the page asks first.
