# ClaimTable

The list view: one row per claim, edited in place. Replaces the card grid of the list view (ClaimCard stays in the person columns of the overview).

Markup: a real `<table>` in a horizontally scrolling wrapper, `<th scope="col">` headers, the provider as `<th scope="row">`. The table keeps `min-width: 880px` and scrolls sideways on narrow screens, values never break inside a cell.

## Columns

1. **Arzt oder Klinik / Doctor or hospital**: bold, with the person marker (colored square and name) below it, because the list mixes all persons.
2. **Rechnungsnummer / Invoice number**: shows "–" while empty, so there is still something to click.
3. **Datum / Date**, in the date format of the settings.
4. **Betrag / Amount**: right-aligned, tabular figures.
5. **Status**: the reimbursement status as the existing badge.
6. **Zahlung / Payment**: a checkbox ("Rechnung bezahlt") and the payment date, or "Nicht bezahlt" while unpaid. Independent of the status column, never merged with it.
7. **Rechnung angehängt**: a file icon when the invoice PDF is attached, empty otherwise. No visible header, the name is for screen readers.
8. **Details**: a chevron button that opens the claim dialog (everything the table does not show: submission date, history, documents, delete).

## Inline editing

- A cell looks like text. Hover shows a hairline outline, the cursor is a text cursor. It is a real button, so the keyboard reaches every cell with Tab.
- Click or Enter on a cell opens it: provider, invoice number, date, amount and payment date become a text field (selected), the status becomes the native select (opened at once).
- **Enter** saves and keeps the focus on the cell. **Escape** discards. **Leaving the field** saves. An unchanged value sends nothing.
- The status and the payment checkbox save at once. Switching the payment on fills today's date, off clears it, as in the dialog.
- Each save is the full claim with that one change, validated by the same rules as the dialog. An invalid value is not sent: while the field is open its error shows below it (`aria-invalid`, `role="alert"`), when the field was left the error shows above the table. A claim that was changed elsewhere (409) shows the conflict message and the list reloads.
- A row with a save in flight is dimmed (`aria-busy`) and waits, so two saves never race.
- **Partly reimbursed** cannot be chosen in the table, it needs the reimbursed amount. The option is disabled, the dialog sets it.
- Dates are typed in the format of the language (placeholder TT.MM.JJJJ / DD/MM/YYYY), there is no calendar popup in the table.

## States and tokens

The open claim's row gets `accent-soft`, hover uses `surface-sunken`, header row `surface-sunken` with `mcg-label` styling. Focus is the 2px `focus` outline. The checkbox is square (hairline `line-strong` border, filled `accent` with a drawn tick when on). Tokens only, readable in both themes.
