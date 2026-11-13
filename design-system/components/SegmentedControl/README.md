# SegmentedControl

A row of mutually exclusive toggle buttons for small settings: language and theme.

Markup: `.mcg-seg` with `role="group"` and an `aria-label`, each option a `<button aria-pressed>`. The consumer provides the options and the current value.

- Language: "DE" / "EN". Switching updates Transloco and the locale for dates, numbers and currency without reload. The choice is stored, the default comes from the browser.
- Theme: "Hell" / "System" / "Dunkel". System follows `prefers-color-scheme` live. The choice is stored under `mcg.theme`.
- Icon-only (`mcg-seg--sm` with icons) only in the narrow top bar, each button with an `aria-label`.
- The selected segment fills `accent` with `on-accent` text. Two to three options, never more.
