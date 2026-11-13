# Field

Labelled text input with the review-specific states: extracted, not recognised, and error.

Markup: `.mcg-field` wrapping a `.mcg-field__head` (label plus optional tag), the `.mcg-input`, and an optional hint or error. The consumer provides the label key, the reactive form control, and the extraction state of the field.

- Every input has a visible `<label for>`. Placeholders are examples, never the label.
- Extracted values get the tag "Aus PDF" / "From PDF" (`mcg-tag--extracted`). Fields the extraction left empty get `mcg-field--missing` (dashed `warning` border) and the tag "Nicht erkannt" / "Not recognised". Both disappear once the user edits the field.
- Errors (`mcg-field--error`) show after blur or submit, with one sentence that says what to enter. Wire `aria-invalid` and `aria-describedby`.
- Amount: `mcg-input--amount` with the `€` suffix, right aligned, tabular. Accept the active locale's format on input, store integer cents.
- Invoice numbers use `mcg-mono`. Dates use the locale format, a native date picker is optional.
- The form has five fields only: provider, invoice number, invoice date, amount, description. Never add bank fields.
