# Reports rules

Reports are regression-sensitive. Any change touching guest, table, seat,
or chair data structures requires a before/after `.xlsx` export check —
open the produced workbook and diff sheet contents, don't just confirm the
export doesn't throw.

Preserve exactly:

- **TABLE PLAN** sheet: four table cards per horizontal group.
- **GUEST LIST** sheet: every guest record.
- **UNASSIGNED** sheet: only guests without a table assignment.
- Companion seats export as `GUEST OF [PRIMARY NAME]`, uppercased.
- Table numbering (`T01`, `B01`, natural sort with VIP/T/B prefix rank)
  and seat numbering.
- Professional workbook formatting (SheetJS, fully offline).
