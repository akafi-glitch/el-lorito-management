# Business rules

Rules are written as plain TypeScript functions (no screen or database code) so each can be tested
alone. The database repeats the critical checks.

Legend: **Built** = implemented and tested. **Planned** = approved, built in the phase shown.

## Access (Built, Phase 1)

- Every page except `/sign-in` and `/api/health` requires a signed-in administrator.
- Usernames: 3–32 characters, lowercase letters, numbers, dots, dashes, starting with a letter or
  number. Typed usernames are trimmed and lowercased.
- Passwords: at least 10 characters (Supabase Auth setting). Stored only as hashes by Supabase Auth.
- A turned-off account (`is_active = false`) cannot sign in and is blocked on every page.
- After sign-in the app returns to the page the person asked for, but only pages on this site.

## Floor layout (Built, Phase 2)

- 45 tables, placed as on the owner's drawing. "4ch" on the drawing = 4 chairs (confirmed).
- Capacities are data. Party 1–3 and Bar 1–4 have no confirmed capacity and show "Seats not set".
- Combined capacity = sum of the chairs (confirmed): A3 + A4 10, B3 + B4 10, C3 + C4 10,
  A4 + B4 12, X6 + X7 + X8 18. Only X6 + X7 + X8 may take parties over twelve.
- **Bar 1–4 are tracked like tables** (status colors and chips) but never take part in the rotation.
- Section X is drawn as one block holding X(1) and X(2); each tile shows its section.
- A table's color comes from two separate facts: whether it has an open visit, and the visit's chips
  status. A table already seated keeps its color if its section is closed meanwhile; empty tables in
  a closed section show gray.

## Seating (Built, Phase 3)

Suggestions live in `src/features/seating/recommend.ts`; the database re-checks every seat.

1. Only free tables are suggested: nobody seated, section open, table active. The Bar is never suggested.
2. **6 or fewer guests:** start at the next section in A → C → B → X(1) → X(2) → P, skipping closed
   sections. In each section, the smallest table that fits (ties: table order). One suggestion per
   section, up to 3, so the first follows the rotation.
3. **7 or more guests:** Party areas first. Their seats aren't set, so each shows "check it fits".
   Then approved combinations with every table free and enough chairs, smallest first. Above 12
   guests only X6 + X7 + X8.
4. If nothing fits, the screen says so and suggests joining tables by hand.
5. **Seating by tapping:** tap one or more free tables, then Seat. The guest count is asked only if it
   wasn't entered in New party. All tables are seated together or none. If the tapped tables are
   exactly an approved combination, that's recorded too.
6. **Anyone** signed in can join any free tables by hand. Every joined table shows "with …".
7. **Rotation (decided):** after any seating, suggested or tapped, the rotation moves to the section
   after the one used. Tables in two sections (A4 + B4) move it past the later one (B). Party and Bar
   seating don't move it. After P it starts again at A.
8. **Closed sections (decided):** can't be seated at all, by suggestion or by tapping. Tapping a table
   there offers "Open section …". Tables already seated keep their color when a section closes.

## Staff (Built, Phase 4)

- **Roles (decided):** waiter, chips runner, manager. Waiter duty: waiters and managers. Chips-runner
  duty: chips runners and managers.
- **Employee numbers** are unique digits (1–6). "01" and "1" count as the same number, so either can
  be typed. A number never changes; a mistake means turning that employee off and adding a new one.
- **Shifts:** one is open at a time. "Start new shift" ends the current shift and every assignment
  in it. Seated tables are not affected.
- **Assignments:** each section has at most one waiter and one chips runner at a time (database
  rule). One person can cover several sections. Moving someone ends the old assignment and starts a
  new one, so history is kept and the latest assignment is always the current one.
- **Chips runners (decided):** for example, Runner 1 covers A, B, C; Runner 2 covers X(1), X(2), P,
  and Party. Coverage is set per section, so it can change at any time.
- **The Bar:** no waiter is assigned (any waiter can bill it); a chips runner can be.
- **Turning someone off** ends their current assignments and keeps all history. Changing a role
  ends any duty the new role can't hold.
- **Sign-in accounts:** any signed-in administrator can add accounts, set a new password, and turn
  accounts off or on. Nobody can turn off their own account, and at least one account stays on.
  Passwords are never shown or stored by the app.

## Waiter section (Built, Phase 5)

- **Identify:** the waiter types their employee number (01 and 1 are the same). Unknown numbers and
  turned-off employees are refused. The number says who is working; it is not a password (the
  administrator sign-in protects the app).
- **Your tables:** the tables of every section assigned to you in the current shift, using the
  latest assignment. Then the Bar, then all other sections.
- **Any waiter can bill a Bar table**, with no "assigned to someone else" warning. The Bar is always
  offered in every waiter's table list, alongside their assigned tables.
- **Another section:** the waiter may open it after confirming "This table is assigned to
  Musfika (02). Do you want to continue?" If nobody is assigned there: "This table is in section C,
  which isn't assigned to you. Do you want to continue?" A waiter with no section this shift sees
  every section, each with this confirmation (except the Bar).
- **Only seated tables open:** a table with no open visit says "No guests are seated at X3. Seat
  them on the Floor first." (Tickets belong to a visit; visits start when guests are seated.)
- From Phase 7, the ticket records the waiter who actually created it.

## Table status (Built, Phase 3)

| Color | Meaning | Tap does |
| --- | --- | --- |
| Green | No open visit | Selects the table for seating |
| Yellow | Seated, chips needed | "Chips served" → red |
| Red | Chips served | "Is the table cleaned?" Yes → green, visit closed (everything kept); No → stays red |
| Gray | Section closed, no one seated | Offers to open the section |

- A yellow table can't be cleared; chips are marked first (database rule).
- Every change carries the version the screen saw. If another device changed the table first, the
  change is refused with "This table was changed on another device" and the floor reloads.
- Every seating, chips, clearing, and section open/close is recorded in the audit history, which
  can't be edited or deleted.

## Menu (Built, Phase 6)

- **Source:** the owner's menu file: 206 items in 25 categories, each with a price, a tax category,
  and on/off availability. Chile con queso is $5.19.
- **Lunch:** served all day. From 3:00 PM restaurant time, each lunch item costs $1.00 more. The
  time and amount are stored on the Lunch category, so they can change without new code.
- **Cheese dip add-ons:** four items at the menu's prices (lunch enchilada $1.25, lunch burrito
  $1.50, combo enchilada $1.00, combo burrito $1.25). They have no 3:00 PM extra.
- **Tax categories:** food and nonalcoholic drinks → food tax (8.5%); beer and cocktails → liquor
  tax (10.5%). Wine is on the cocktail page, so it is taxed as liquor.
- **Search** matches the start of words in an item's name, description, or category, ignoring case,
  accents, and punctuation: "combo 5" finds Combo #5, not Combo #15. Name matches come first.
- **Order on screen:** tap to add; quantities 1 to 99; remove a line with Remove.
- **Prices:** Management can change a price or turn an item off. New prices apply to new tickets
  only; tickets keep the price they were made with (Phase 7). Items are never deleted.

## Tickets (Built, Phases 7–9)

- A ticket belongs to the group seated at the table (the visit) and to the waiter who made it.
  Any number of tickets per group. Numbers start at 1001 and never reset; a refused save uses no
  number.
- **Editable until printed:** add items, remove items, change quantities. Printing (Phase 9) locks
  it for good; changes after printing mean a new ticket.
- **Prices:** the database copies each item's name, price, and tax group onto the ticket when the
  item is first saved on it. From 3:00 PM lunch items get $1.00 more at that moment. A line keeps
  its price when its quantity changes later. Menu changes never touch saved tickets.
- **Turned-off items** can't be added; one already on the ticket can stay.
- **Cancel:** an unprinted ticket made by mistake can be cancelled. It stays in the history, read-only.
- **Two devices:** every save carries the version the screen saw. If someone else saved first,
  the save is refused ("Someone else just changed this ticket") and the screen shows the newer version.
- **Table cleared:** its tickets are kept and can no longer be changed. A save that arrives while
  the table is being cleared waits, then is refused. The next group starts with no tickets.
- Every save and cancel is recorded in the audit history, with the lines before and after.

## Printing (Built, Phase 9)

- **Save first:** Print saves the ticket if the screen has changes, then prints what was saved.
- **Locks for good:** the first print locks the ticket and freezes its totals and tax rates on it,
  so later menu, price, or tax-rate changes never alter a printed ticket.
- **Print again:** any number of times, by any active waiter, even after the table is cleared.
  Every print request is kept (attempt 1 is the first print, then reprints 2, 3, ...).
- **No false claims:** the browser can't tell whether paper came out. After each print the waiter
  answers "Did it print?"; the answer is stored as the waiter's report. Yes ends the print workflow
  on the home page; No offers Print again.
- **On the ticket:** EL LORITO, Mexican Restaurant, ticket number, table (joined tables as
  "X6 + X7 + X8"), waiter number only (owner decision Oct 27, 2026), date and time of the first
  print, each item with quantity and price (and "@ each" when more than one), food subtotal, liquor
  subtotal, food tax 8.5%, liquor tax 10.5%, total.
- **Paper:** 80 mm by default; `RECEIPT_PAPER_WIDTH_MM=58` for 58 mm paper. Only the receipt prints.
- Printing never marks anything paid and never clears the table.

## Tax (Built, Phase 8; rounding approved Oct 27, 2026)

```
Total = Food sub + Liquor sub + round(Food sub × 0.085) + round(Liquor sub × 0.105)
```

- Money is whole cents; rates are basis points (850, 1050). No floating-point money math.
- Rounding: once per group on the group subtotal, half-up to the cent.
- Example: $7.50 food + $5.25 beer → food tax $0.64, liquor tax $0.55, total **$13.94**.
- Each tax is rounded once on its subtotal, never per line: three $1.00 food items are taxed
  $0.255 → $0.26 (not 3 × $0.09 = $0.27).
- Food and nonalcoholic drinks are added into the food subtotal; beer and cocktails (including
  wine) into the liquor subtotal. A line's tax group is copied onto the ticket when it is saved.
- The database works out saved tickets' totals (`ticket_totals`); the screen shows the same rule
  as a preview while the ticket is built. Both are tested with the same examples.
