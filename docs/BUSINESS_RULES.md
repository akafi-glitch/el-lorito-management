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

## Waiter section (Planned, Phase 5)

- **Any waiter can bill a Bar table**, with no "assigned to someone else" warning. The Bar is always
  offered in every waiter's table list, alongside their assigned tables.

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

## Tickets (Planned, Phases 7–9)

- Editable until printed. Printing locks the ticket for good; every printed ticket is kept.
- Any number of tickets per table; changes after printing mean a new ticket.
- Item name and price copied at order time; menu changes never touch old tickets.
- Ticket numbers start at 1001 and never reset (proposed).

## Tax (Planned, Phase 8; rounding needs approval)

```
Total = Food sub + Liquor sub + round(Food sub × 0.085) + round(Liquor sub × 0.105)
```

- Money is whole cents; rates are basis points (850, 1050). No floating-point money math.
- Rounding: once per group on the group subtotal, half-up to the cent.
- Example: $7.50 food + $5.25 beer → food tax $0.64, liquor tax $0.55, total **$13.94**.
