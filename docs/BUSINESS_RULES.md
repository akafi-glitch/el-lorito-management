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
- **X(1):** X4, X5, X6, X7, X8, X9, X13, X14. **X(2):** X1, X2, X3, X10, X11, X12 (owner's definitive
  list, Nov 2, 2026). X6 + X7 + X8 stays approved, now all in X(1).
- A table's color comes from two separate facts: whether it has an open visit, and the visit's chips
  status. A table already seated keeps its color if its section is closed meanwhile; empty tables in
  a closed section show gray.

## Seating (Built, Phase 3)

Suggestions live in `src/features/seating/recommend.ts`; the database re-checks every seat.

1. Only free tables are suggested: nobody seated, section open, table active. The Bar is never suggested.
2. **6 or fewer guests:** start at the next section of this shift's rotation, skipping closed
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
7. **Rotation (decided Nov 2, 2026):** the manager drags the dining sections into order when starting
   each shift, and can change it during the shift. New suggestions follow the change at once, from the
   section that is next (or another one the manager picks). Every shift keeps its own order in the
   history. After any seating, suggested or tapped, the rotation moves to the section after the one
   used, in this shift's order. Tables in two sections (A4 + B4) move it past the later of the two.
   Party and Bar seating don't move it. After the last section it starts again at the first. Starting a
   new shift starts at its first section and never touches seated tables or orders.
8. **Closed sections (decided):** can't be seated at all, by suggestion or by tapping. Tapping a table
   there offers "Open section …". Tables already seated keep their color when a section closes.

## Staff (Built, Phase 4)

- **Roles (decided):** waiter, chips runner, manager. Waiter duty: waiters and managers. Chips-runner
  duty: chips runners and managers.
- **Employee numbers** are unique digits (1–6). "01" and "1" count as the same number, so either can
  be typed. A number never changes; a mistake means turning that employee off and adding a new one.
- **Shifts:** one is open at a time. "Start shift" asks for the rotation and starts at its first
  section. While a shift is open, the button is "Finish shift" (owner decision, Nov 2, 2026), which asks
  first, names any open tickets, then ends the shift and every assignment in it. Seated tables, visits,
  tickets, and history are not affected.
- **Closed:** with no open shift the restaurant is closed. The Waiter Section says so, waiters already
  inside are taken out of it, and the database refuses new orders. It opens by itself when a manager
  starts a shift. Open tickets stay open: a customer receipt still being printed can finish, and waiters
  can pick up the rest in the next shift. The Floor and Management keep working.
- **Assignments:** each section has at most one waiter and one chips runner at a time (database
  rule). One person can cover several sections. Moving someone ends the old assignment and starts a
  new one, so history is kept and the latest assignment is always the current one.
- **Chips runners (decided):** for example, Runner 1 covers A, B, C; Runner 2 covers X(1), X(2), P,
  and Party. Coverage is set per section, so it can change at any time.
- **The Bar:** no waiter is assigned; a chips runner can be. Assignments are for floor management:
  they never limit which tables a waiter can order for.
- **Turning someone off** ends their current assignments and keeps all history. Changing a role
  ends any duty the new role can't hold.
- **Sign-in accounts:** any signed-in administrator can add accounts, set a new password, and turn
  accounts off or on. Nobody can turn off their own account, and at least one account stays on.
  Passwords are never shown or stored by the app.

## Waiter section (Rebuilt Nov 2, 2026)

- **Identify:** the waiter types their employee number (01 and 1 are the same). Unknown numbers and
  turned-off employees are refused. The number says who is working; it is not a password (the
  administrator sign-in protects the app).
- **Any table:** Select Section, then a list shows exactly that section's tables, from the database. Tapping a
  table goes straight to its order page. Nothing limits a waiter to their assigned section and there is no
  warning. Their section this shift is shown, and picked first, only as a convenience.
- **Separate from the Floor (owner decision, Nov 2, 2026):** the Waiter Section never looks at whether a table
  is vacant, seated, or closed, or how many guests there are, and never asks. Orders don't seat anyone, change
  the chips, or move the rotation. Seating, chips, and clearing on the Floor never change an order. Both sides
  use the same table codes, and nothing else connects them.
- **Kitchen receipt markers (owner decisions, Nov 2, 2026):** they show which table needs which receipt, in the
  waiter's list under the table's name and on its page. **Green, "Kitchen Receipt Saved":** an order with items still
  needs its kitchen receipt, including one that didn't print or has no answer yet. **Blue, "Kitchen Receipt Printed":**
  every order's kitchen receipt is confirmed printed, so the customer receipt is next. A new order turns a blue table
  green again until it prints. After the customer receipt is confirmed printed or the ticket is cancelled, the table
  looks normal again.
- The ticket keeps the waiter who started it; each order keeps the waiter who took it.

## Table status (Built, Phase 3)

| Color | Meaning | Tap does |
| --- | --- | --- |
| Green | No open visit | Selects the table for seating |
| Yellow | Seated, chips needed | Red straight away, with no question. Undo is offered |
| Red | Chips served | "Is the table cleaned?" Yes → green, visit closed (everything kept); No → stays red. "Undo chips served" is here too |
| Gray | Section closed, no one seated | Offers to open the section |

- A yellow table can't be cleared; chips are marked first (database rule).
- **Undo:** back to yellow, for any employee, on every table of a joined party. It carries the version
  the screen saw, so if someone has changed the table since (cleared it, served again, undid it) nothing
  changes and the screen says so. Serving and undoing are both in the audit history.
- A tap shows at once and the rest of the floor stays usable; the database still decides, and a refused
  change goes back with a message.
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

## Tickets and orders (Rebuilt Nov 2, 2026)

- **One open ticket per table:** adding items never makes a new ticket: each submitted order is a batch on the
  table's open ticket, with its own ID, waiter, time, and one optional note. Numbers start at 1001 and never
  reset; a refused save uses no number.
- **The customer receipt resets the table:** when the waiter confirms it printed, the ticket is finalized and the
  table is ready again. The next order starts a new ticket. Cancelling a ticket frees the table the same way. If
  the waiter says it didn't print, or doesn't answer, the ticket stays open and nothing resets.
- **Earlier tickets:** the table's page lists its finalized and cancelled tickets from this shift, to see or
  reprint them. Everything else is in Management's Order History.
- **Save Order** saves what is on screen; nothing prints. Pressing it twice saves once (the screen sends
  one key per order). Two waiters adding at once get two orders; nothing is overwritten.
- **Custom items:** name, price ($0.00 or more), quantity (1 to 99), and a tax type the waiter must choose:
  it is never guessed, so a liquor item can't take the food rate. Saved on that order only; never added to the menu.
- **Item notes (owner decision, Nov 2, 2026):** every item of an order can have its own note, written under it
  while ordering or later on the saved ticket, up to 200 characters. An item appears once per order, so "1 no
  onions" goes in its note. The note for the whole order stays. Item notes never print on the customer's bill.
- **Before finalizing:** quantities can change, lines can be removed, notes can be edited, and the ticket
  can be cancelled. Each change carries the version the screen saw; if someone changed the ticket first it
  is refused ("Someone else just changed this ticket") and the screen shows the latest.
- **Prices:** the database copies each menu item's name, price, and tax group when the order is saved. From
  3:00 PM lunch items get $1.00 more at that moment. Menu changes never touch saved orders.
- **Turned-off items** can't be ordered.
- **Table cleared on the Floor:** nothing happens to the order. An open ticket stays open until its customer
  receipt is printed or it is cancelled.
- Every save, change, cancel, print, answer, and finalization is in the audit history.
- **Tickets from before this rule** stay as they are. Each now belongs to the first table of its group. A group
  still seated keeps its open ticket as the table's current one. An open ticket whose group was already cleared
  keeps its frozen totals, stays in the history as Open, and no longer holds the table.

## Kitchen receipts (Built Nov 2, 2026)

- **Print Kitchen Receipt** saves what is on screen first, then prints every order not printed yet,
  each with its own heading. Later receipts show only new orders. A chosen order can be reprinted, marked
  REPRINT so it isn't cooked twice.
- **Shows:** EL LORITO — KITCHEN, ticket, table, waiter number (of that order), order number, date and time,
  quantities and item names in large bold capitals, each item's note under it, and the order's note. **Never any price, subtotal, tax, or total:**
  the receipt's data has no place for them.
- After each print the waiter answers "Did the kitchen receipt print?". An order waiting for an answer isn't
  sent again by accident; a No sends it next time. Printing never locks or finalizes anything.
- A changed quantity on an order the kitchen already has is not re-sent: the waiter tells the kitchen.

## Customer receipts and finalizing (Built Nov 2, 2026)

- **Shows:** EL LORITO, ticket number (the same as the kitchen's), waiter number only, table (joined tables as
  "X6 + X7 + X8"), date and time, each item with quantity, price, and line total, food subtotal, liquor subtotal,
  food tax 8.5%, liquor tax 10.5%, total, THANK YOU! All saved orders are included; the same item at the same
  price is one line.
- **It can't be printed over unsaved items:** the waiter saves or removes the new order first.
- **No false claims:** the browser can't tell whether paper came out. Opening the print dialog changes nothing.
  The waiter is asked "Did the customer receipt print?". **Yes finalizes the ticket**; No, or leaving the
  question unanswered, leaves it open, and each attempt is on record as printed, not printed, or unknown.
- **The exact bill is kept:** the ticket keeps the bill from the attempt that was confirmed, with its totals
  frozen. If the ticket changed after that receipt was made, Yes is refused and nothing is finalized.
- **Once finalized:** no more orders or tickets for that group, and no change to items, quantities, prices,
  or notes. The database itself refuses them, even a direct write. The receipt can be reprinted any number of
  times, marked COPY, exactly as first printed. The host can still clear the table.
- Answering twice, or from two devices, finalizes once.
- **Paper:** 80 mm by default; `RECEIPT_PAPER_WIDTH_MM=58` for 58 mm paper. Only the receipt prints.
- Printing never marks anything paid and never clears the table.

## Order history (Built Nov 2, 2026)

- **Management → Shift Report (owner decision, Nov 2, 2026):** one shift at a time, opening on the most recent, to
  read or print on the receipt printer at any point, during the shift or after it. It shows only ticket numbers and
  totals with tax, then the shift total. Only tickets whose customer receipt printed are added in. Open tickets are
  named apart and not added, and cancelled ones are left out. A ticket counts in the shift it was started in.
- **PIN for Order History and the Shift Report (owner decision, Nov 2, 2026):** these two areas open only with a
  manager's employee number and their own PIN of 6 to 12 digits, and nothing else in the app asks for one. The session
  ends after 15 minutes without real use, after 12 hours at most, with **Lock**, or when the app signs out. 5 wrong tries
  block that number for 10 minutes, for everyone, on every device. The answer is always "Incorrect PIN", whether or not
  the employee exists or has a PIN. Logins, failures, lockouts, and Lock are in the audit history, with the employee
  number and time. PINs are set, reset, and turned off with `npm run admin:pin`, on the owner's computer. A waiter still
  sees a table's earlier tickets from this shift on its page, and reprints work without a PIN, as the owner asked.
- **Management → Order History:** ticket, date and time, shift, waiter number, table, total with tax, and status.
  Most recent first; can be sorted oldest first, and filtered by shift and by waiter. No food items in the table;
  a ticket's own page shows them, and can print a copy of its receipt.
- Totals are what the ticket saved, never current menu prices. The waiter is who started the ticket, whatever
  assignments change later. Tickets stay after the table goes vacant. Nothing is ever deleted.
- Cancelled tickets stay listed, greyed and marked cancelled.

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
