# StatusBadge

Compact square label for a claim status or an extraction status.

Markup: `<span class="mcg-badge mcg-badge--open">`. The consumer provides the status value and maps it to the translated word.

- Claim status: `DRAFT` default badge "Entwurf", `OPEN` `mcg-badge--open` "Offen".
- Extraction status in the dialog: `PENDING` `--pending`, `DONE` `--done`, `FAILED` `--failed`.
- The word is the signal, the color and the square dot support it. Never show a badge without text.
- Later statuses (submitted, reimbursed, rejected) get added here when the workflow exists, not before.
