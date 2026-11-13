# PersonCard

One dashboard column per person: name, total and count for the selected year, and the compact claims table.

Markup: `<section class="mcg-person" style="--person: <person color>">`. The consumer provides the person (name, color), the year, the dashboard figures, and the claim list for the embedded ClaimTable.

- The person's color shows as the 4px top bar (`border-bar`) and the 8px square before the name. Default colors are `person-1` to `person-3`. Never tint the card body.
- The total is the hero figure: `figure`, tabular, locale formatted. The count sits on the right.
- Three columns side by side from 1024px, stacked below. All three cards always show, even without claims for the year. A person without claims shows one muted line, not the full empty state.
- "Umbenennen" / "Rename" opens an inline edit of the name. Keep it ghost, it is rarely used.
- In the card the table drops the invoice number and status columns when the card is narrower than 420px.
