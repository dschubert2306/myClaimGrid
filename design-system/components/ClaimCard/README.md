# ClaimCard

One claim with all its status fields at a glance. Used in the person columns of the overview and in the grid of the list view. Replaces the former ClaimTable.

Markup: `<article class="app-claim-card">` with an `<h3>` holding a real button (the provider) that is stretched over the whole card (`::after`, `inset: 0`), so a click anywhere opens the claim dialog and the keyboard has one tab stop per card. The consumer provides the claim and, in the list view, the person.

- Order: provider (title), meta line (date, invoice number, person marker in the list view), the two status badges, then the figures.
- **Two separate badges**, each under its own label: "Erstattung" / "Reimbursement" (reimbursement status) and "Zahlung" / "Payment" (payment status with its date: "Bezahlt am 20.03.2026" / "Paid on 20/03/2026", or "Nicht bezahlt" / "Not paid"). They are never merged.
- Figures (`dl`, labels in `mcg-label`): invoice amount, reimbursed, outstanding, the difference to the invoice amount (only for "Teilweise erstattet"), submission date ("Noch nicht" / "Not yet" while empty), number of insurer documents.
- Amounts are tabular and formatted with the active locale. The figures grid wraps by itself (`auto-fit`, 110px minimum).
- The open claim's card gets `aria-current="true"` and the `accent-soft` ground. Hover uses `surface-sunken`. Square corners, `line-strong` outline, tokens only, readable in both themes.
- Person column: cards stack. List view: `repeat(auto-fill, minmax(320px, 1fr))`, one column below 640px.
- No pagination. Volumes are small.
