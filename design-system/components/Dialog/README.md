# Dialog

Modal for one claim: creating, reviewing, reimbursement, payment and insurer documents in a single form with one primary action.

Markup: `.mcg-scrim` (CDK overlay backdrop) holding `.mcg-dialog` with `role="dialog"`, `aria-modal="true"` and `aria-labelledby`. Inside: `.mcg-dialog__head`, the scrolling body, `.mcg-dialog__foot`. The consumer provides the form state and, when an invoice PDF was uploaded, the presigned PDF URL for the preview.

- No steps. The same dialog creates ("Neue Rechnung") and edits ("Rechnung bearbeiten"). A new claim starts with the person Select and an optional Dropzone for the invoice PDF, which fills the empty fields below ("Aus PDF" / "Nicht erkannt" tags).
- Sections, each a `role="group"` with an `h3` (`title-3`) and a hairline above all but the first: "Rechnung", "Erstattung", "Zahlung", "Dokumente der Versicherung".
- "Erstattung": submission date, status Select with the date of the status, reimbursed and rejected totals (only for the payment statuses) with the difference line for "Teilweise erstattet", a note, and the history as a plain list (date, badge, amounts, note), newest first. Saving a change adds one entry, nothing in the list is editable.
- "Zahlung": a switch "Rechnung bezahlt" (square track, the thumb position and the filled track both show the state) and, while it is on, the required payment date. Switching on prefills today, switching off clears the date.
- "Dokumente": stored files (name opens a short-lived link, X marks it for removal), chosen files, and the Dropzone markup. Uploads and removals are applied with the save.
- The dialog never grows taller than the window: head and foot stay in view, the body scrolls. With an invoice PDF the body is the split layout (form left, PDF in `.mcg-dialog__pdf` right on `surface-sunken`, below 900px under the form). Embed the PDF in an `<iframe>`, not an `<object>`: Chrome blocks an `<object>` that starts without data under the CSP for good.
- Footer: "Löschen" (danger, edit only) on the left, Cancel and the one primary "Speichern" on the right. Cancel, Escape and the close button ask once if anything was edited, and delete an unsaved invoice draft.
- Focus trap via `cdkTrapFocus`, first field focused on open, focus returns to the opener on close. Body scroll locked.
