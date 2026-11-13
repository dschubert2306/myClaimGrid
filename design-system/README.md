myClaimGrid tracks health insurance invoices for three persons. The interface is a working tool, not a showcase: calm neutrals, one teal accent, square corners everywhere, and figures that line up. The grid in the name is literal. Layouts snap to the spacing scale, tables carry the content, and color is reserved for state and for telling the three persons apart.

## Principles

- Square, always. `radius` is `0` and is the only radius. Apply it to every element, form controls, focus rings, scrollbars and the dialog included. Set `appearance: none` on native inputs and selects so the browser cannot round them.
- Lines, not shadows. Separate cards and sections with a `border-hairline` border in `line`. `shadow-overlay` belongs to the dialog and menus only.
- One accent. `accent` marks the primary action, the selected state, links and the focus ring. Do not use it for decoration.
- Numbers first. Totals and amounts are what people come for. Set them in `figure` / `figure-sm` with `font-variant-numeric: tabular-nums`, right aligned in tables.
- Nothing about bank accounts. No component, label, placeholder or example ever shows IBAN, BIC or account numbers.

## Content

- The UI speaks German and English, switched at runtime. Every string comes from `de.json` / `en.json`. Never hardcode copy in a template.
- Address the user informally in German ("Wähle eine Datei aus"), plainly in English ("Choose a file"). No exclamation marks, no emoji.
- Sentence case for buttons, titles and labels in both languages. Labels render uppercase through the `label` style, the translation string stays sentence case.
- Name things the way people do. German uses "Rechnung" for a claim, English uses "claim". Examples: "Neue Rechnung" / "New claim", "PDF hochladen" / "Upload PDF", "Manuell erfassen" / "Enter manually", "Daten prüfen" / "Review data", "Speichern" / "Save", "Abbrechen" / "Cancel".
- Status words: `DRAFT` "Entwurf" / "Draft", `OPEN` "Offen" / "Open". Extraction: `PENDING` "Wird ausgelesen" / "Reading", `DONE` "Ausgelesen" / "Read", `FAILED` "Nicht lesbar" / "Could not read".
- Fields the extraction left empty say so: "Nicht erkannt" / "Not recognised". Never guess a value to fill the gap.
- Formatting follows the active language: `de-DE` writes `1.234,56 €` and `12.03.2026`, `en-GB` writes `€1,234.56` and `12/03/2026`. Use Angular's `CurrencyPipe` and `DatePipe` with the active locale, never string concatenation. Amounts are stored as integer cents and formatted only at the edge.

## Color

- Page ground is `bg`. Cards, the top bar, inputs and the dialog sit on `surface`. Table headers, the PDF preview pane and read-only fields use `surface-sunken`.
- Text is `ink`. Secondary text (labels, table headers, helper text, metadata, placeholders) is `ink-muted`. Both hold 4.5:1 on `bg`, `surface` and `surface-sunken` in both themes.
- Control borders use `line-strong` (3:1 on `surface` and `bg`). `line` is for dividers that carry no meaning.
- Primary buttons fill `accent` with `on-accent` text, hover `accent-hover`. Do not put white text on `accent` in dark mode, `on-accent` is dark there.
- States: `accent` / `accent-soft` for OPEN and for selected rows, `warning` / `warning-soft` for PENDING and for fields the extraction left empty, `danger` / `danger-soft` for FAILED and validation errors. Every state also carries a word, never color alone.
- Persons: `person-1`, `person-2`, `person-3` are the defaults for the `color` attribute of the three persons. Use them as the `border-bar` on top of a person card and as an 8px square marker next to the name. Never fill large areas or set text in a person color.
- Backdrop behind the dialog is `scrim`.

## Themes

- Two themes, `light` and `dark`, switched by `data-theme` on `<html>`. Tokens resolve through CSS custom properties, components never branch on the theme.
- The theme control has three states: "Hell" / "Light", "System", "Dunkel" / "Dark". System reads `prefers-color-scheme` and follows changes live. The manual choice is stored in `localStorage` under `mcg.theme` (wrapped in try/catch, falling back to System).
- Set `data-theme` before Angular boots (a tiny inline script in `index.html`) so the page never flashes the wrong theme.

## Type

- One family, IBM Plex Sans (`font-sans`), with IBM Plex Mono (`font-mono`) for invoice numbers and claim IDs. Self-host both through the `@fontsource` packages (no Google Fonts: hotlinking transfers visitor IP addresses to Google and opens the CSP), weights 400, 500 and 600 for Sans, 400 and 500 for Mono.
- Page title `title-1`. Dialog title and person name `title-2`. Sections `title-3`. Body `body`, table cells and helper text `body-sm`. Field labels and table headers `label`. Card totals `figure`, amounts in tables and inputs `figure-sm`. Invoice numbers `mono`.
- `display` appears on the sign-in screen and the empty state only.

## Spacing and layout

- Spacing comes only from the `space-*` scale. 5px or 10px does not exist here.
- Top bar is `topbar-height` tall, `surface` with a bottom `line` border. Content is centred to `content-max` with a `space-8` gutter (`space-4` below 640px).
- Dashboard: one column per person, three columns from 1024px, stacked below. Gap `space-6`. Columns are flush grid cells with a shared hairline grid look, not floating cards.
- Controls are `control-md` tall. Compact controls (`control-sm`) only inside tables and the top bar on narrow screens.
- Dialog: entry step 560px wide, review step up to `dialog-max` with the form left (about 40%) and the PDF preview right. Below 900px the preview moves under the form.

## Interaction

- Focus is visible on every interactive element: `outline: 2px solid var(--focus)` with `outline-offset: 2px`, square. Never remove it without replacing it.
- Hover changes the ground (`surface-sunken` on rows and secondary buttons) or the fill (`accent-hover`). No scale or lift effects.
- Motion is short and functional: 120ms ease-out for hover and color changes, 160ms for the dialog fade. Respect `prefers-reduced-motion` and drop transitions there.
- The dialog uses Angular CDK overlay and `cdkTrapFocus`. Escape cancels, which deletes the draft and its file. The first field receives focus on open.
- Disabled controls drop to 40% opacity and keep their border. Prefer explaining why something is unavailable over disabling it silently.

## Sign-in

- Signed-out users land on the LoginPage at `/login`. It explains the app in one line and offers one button, "Anmelden" / "Sign in", which starts the Cognito authorization code flow with PKCE.
- The app never renders its own password field. Credentials, TOTP and password reset stay on the Cognito managed login, styled with the tokens as far as its branding options allow.
- There is no sign-up link anywhere. Access is by invitation only.

## Iconography

- No icon set is defined yet. Use simple inline SVG line icons on a 20px grid, 1.5px stroke, square line caps and miter joins so they match the square corners, colored with `currentColor`.
- Needed for release 1: upload, file (PDF), plus, close, chevron down, sun, moon, monitor (system theme), sign out, alert. Keep icons beside a word, never as the only label, except the dialog close button which carries an `aria-label`.

## Building with it

- Components are plain Angular standalone components styled with the classes in `components/bundle.css` (prefix `mcg-`). The previews in this system are static HTML with those classes, so they port 1:1 into Angular templates.
- Tokens become `styles/tokens.scss` as CSS custom properties, exactly as named here (`--surface`, `--space-4`, `--radius`).
