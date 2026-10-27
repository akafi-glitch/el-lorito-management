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

## Seating (Planned, Phase 3)

1. Only vacant, active tables in open sections are considered. Bar is never recommended.
2. 7+ guests: Party areas first (capacity unknown → "confirm the party fits"), then approved
   combinations that fit with every table vacant. Above 12 guests only X6 + X7 + X8.
3. 6 or fewer: start at the next section in A → C → B → X(1) → X(2) → P, skipping closed sections;
   pick the smallest table that fits; else the next section.
4. Show the top 3; the host confirms; the table turns yellow showing the guest count.
5. The rotation moves to the section after the one used.
6. Manual seating: tap one or more vacant tables; ask guest count if not entered; all seated together or none.
7. **Anyone** (manager, host, or other staff) can join any vacant tables into a combination by hand.
   All of its tables show occupied.

## Waiter section (Planned, Phase 5)

- **Any waiter can bill a Bar table**, with no "assigned to someone else" warning. The Bar is always
  offered in every waiter's table list, alongside their assigned tables.

## Table status (Planned, Phase 3)

| Color | Meaning | Action |
| --- | --- | --- |
| Green | No open visit | Seat |
| Yellow | Seated, chips needed | Chips served → red |
| Red | Chips served | Chips runner: "Is the table cleaned?" Yes → green, visit closed (tickets kept); No → stays red |
| Gray | Section closed | Not recommended; manual seating allowed |

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
