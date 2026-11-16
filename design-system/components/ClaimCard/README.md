# ClaimCard

One claim, compact. Used in the person columns of the overview. The list view is the editable ClaimTable, which carries all the figures.

Markup: `<article class="app-claim-card">` with an `<h3>` holding a real button (the provider) that is stretched over the whole card (`::after`, `inset: 0`), so a click anywhere opens the claim dialog and the keyboard has one tab stop per card. The consumer provides the claim and, where claims of several persons are mixed, the person.

- Order: provider (title), meta line (date, invoice number, optional person marker, file icon), then one status row.
- Meta line: the file icon sits at the right end and only appears when insurer documents are attached. It has `role="img"` and a label with the count ("Dokumente: 2" / "Documents: 2"); the count is not shown as text.
- Status row (wraps on narrow columns): "Erstattung" / "Reimbursement" badge, "Zahlung" / "Payment" badge (with its date: "Bezahlt am 20.03.2026" / "Paid on 20/03/2026", or "Nicht bezahlt" / "Not paid") and the invoice amount, each under its own `mcg-label`. The two badges are never merged.
- Not on the card: reimbursed, outstanding, difference to the invoice amount, submission date. They live in the claim dialog, the ClaimTable and the person figures.
- The amount is tabular and formatted with the active locale.
- The open claim's card gets `aria-current="true"` and the `accent-soft` ground. Hover uses `surface-sunken`. Square corners, `line-strong` outline, tokens only, readable in both themes.
- Person column: cards stack. No pagination. Volumes are small.
