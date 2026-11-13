# Dialog

Modal for creating and reviewing a claim, with a step strip, a split review layout and a fixed footer.

Markup: `.mcg-scrim` (CDK overlay backdrop) holding `.mcg-dialog` with `role="dialog"`, `aria-modal="true"` and `aria-labelledby`. Inside: `.mcg-dialog__head`, `.mcg-steps`, the body, `.mcg-dialog__foot`. The consumer provides the step state, the form, and the presigned PDF URL for the preview.

- Steps for upload mode: "Person und Art" / "Person and type", "Auslesen" / "Reading", "Daten prüfen" / "Review data". Manual mode skips the middle step and the PDF pane, the dialog stays narrow (`mcg-dialog--narrow`).
- Step 1 uses `.mcg-choice` for the mode ("PDF hochladen" / "Manuell erfassen"), the person Select, and the Dropzone.
- Review step: form left, PDF in `.mcg-dialog__pdf` right on `surface-sunken`. Embed the presigned GET URL in an `<object type="application/pdf">` or the browser viewer. Below 900px the preview moves under the form.
- Footer: Back left, Cancel and the primary action right. Cancel, Escape and the close button all delete the draft and its file, so ask once if the user has edited fields.
- Focus trap via `cdkTrapFocus`, first field focused on open, focus returns to "Neue Rechnung" on close. Body scroll locked.
- Opening an existing claim from the table reuses the review step with "Rechnung bearbeiten" as title and "Löschen" as a danger button in the footer left.
