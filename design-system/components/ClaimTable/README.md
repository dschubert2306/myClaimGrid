# ClaimTable

Compact table of one person's claims for the selected year: date, provider, invoice number, amount, status.

Markup: `<table class="mcg-table">`. The consumer provides the claim list (already filtered by person and year, sorted by invoice date descending) and the row click handler.

- Row click and Enter open the claim in the review dialog. Give rows `tabindex="0"` and handle Enter and Space, or put a real button in the provider cell.
- Amounts right aligned, tabular, formatted with the active locale. Invoice numbers in `mcg-mono`. Dates in the locale's short format.
- Provider is the only column that wraps. Everything else stays on one line.
- The currently open claim's row gets `aria-selected="true"`.
- No pagination in release 1. Volumes are small.
