# Button

Square action button in four variants: primary, secondary (default), ghost and danger.

Markup: `<button class="mcg-btn mcg-btn--primary">`. The consumer provides the label (a translation key), an optional leading icon as inline SVG, and `type="button"` unless it submits a form.

- One primary button per view or dialog step: "Neue Rechnung" on the dashboard, "Speichern" / "Weiter" in the dialog.
- Secondary for Cancel and Back. Ghost for low-weight actions in the top bar (sign out) and the dialog close button.
- Danger is outlined, never filled. Use it for "Rechnung löschen" only, and confirm before deleting.
- `mcg-btn--sm` (`control-sm`) inside tables and the narrow top bar. `mcg-btn--icon` needs an `aria-label`.
- Disabled buttons keep their place and size. While the claim saves, keep the button enabled and show the progress elsewhere rather than swapping the label.
- Don't put two primary buttons side by side, don't round the corners, don't add shadows.
