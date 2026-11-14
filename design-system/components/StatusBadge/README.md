# StatusBadge

Compact square label for a claim status or an extraction status.

Markup: `<span class="mcg-badge mcg-badge--open">`. The consumer provides the status value and maps it to the translated word.

- Claim status: `DRAFT` default badge "Entwurf", `OPEN` `mcg-badge--open` "Offen".
- Extraction status in the dialog: `PENDING` `--pending`, `DONE` `--done`, `FAILED` `--failed`.
- The word is the signal, the color and the square dot support it. Never show a badge without text.
- Reimbursement status (how far the insurer is): `OPEN` default badge "Offen" / "Open", `IN_PROGRESS` `--pending` "In Bearbeitung" / "In progress", `PARTLY_PAID` `--partial` "Teilweise erstattet" / "Partly reimbursed", `PAID` `--done` "Erstattet" / "Reimbursed". `--partial` uses the `accent` colors with a half filled, outlined dot, so it differs from `--done` in shape and word, not only in color. While the status is `OPEN` and the claim has no submission date, the muted text "nicht eingereicht" / "not submitted" follows the badge.
- Self-payment (did the user pay the invoice): `--done` "Bezahlt" / "Paid", default badge "Nicht bezahlt" / "Not paid". It is a separate dimension and always gets its own column or label, never merged into the reimbursement badge. The reimbursement words say "erstattet" / "reimbursed", the payment words say "bezahlt" / "paid", so the two never read alike.
- There is no "rejected" status. A full rejection is recorded as `PAID` with 0 reimbursed and the rejected amount.
