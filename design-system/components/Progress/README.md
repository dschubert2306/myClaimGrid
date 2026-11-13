# Progress

Thin 4px bar for the upload (determinate) and the extraction wait (indeterminate).

Markup: `.mcg-progress` with a text row and `.mcg-progress__bar` (`role="progressbar"`). The consumer provides the label, and for uploads the percentage.

- Upload to S3 shows real progress from the HTTP upload events.
- Extraction polling (every 1.5 s, up to 60 s) shows the indeterminate bar and the PENDING badge. On `DONE` move to the review step. On `FAILED` or timeout move to the review step with an empty form and say "Die Rechnung konnte nicht ausgelesen werden. Bitte trage die Daten selbst ein."
- With `prefers-reduced-motion` the indeterminate bar stands still at half opacity.
