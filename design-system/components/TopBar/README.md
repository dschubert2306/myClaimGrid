# TopBar

The single app bar: product name on the left, year selector, language switch, theme switch and sign out on the right.

Markup: `<header class="mcg-topbar">`. The consumer provides the year list, the current language and theme, and the sign-out handler.

- The product name is always written "myClaimGrid". The mark is a 2×2 square grid in `ink` and `accent`, drawn in CSS, no image.
- Order on the right is fixed: year, language, theme, sign out.
- Below 640px the theme switch goes icon-only, controls switch to `control-sm`, and "Abmelden" becomes an icon button with `aria-label`.
- No navigation menu in release 1. The dashboard is the only page.
