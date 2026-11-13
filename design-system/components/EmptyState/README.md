# EmptyState

Shown on the dashboard when no person has a claim in any year yet.

Markup: `.mcg-empty` with the grid motif, a title, one sentence and the primary button. The consumer provides the year and the handler that opens the dialog.

- Only when the whole account is empty. A single person without claims for the selected year gets one muted line in its PersonCard instead.
- The motif is a 3×3 square grid with the centre cell in `accent`, drawn in CSS. No illustrations.
- Title names the year, the sentence says what happens next, the button is the same "Neue Rechnung" as in the page header.
