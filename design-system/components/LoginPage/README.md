# LoginPage

Sign-in landing page shown to signed-out users. It explains the app in one line and hands off to the Cognito managed login, it never asks for a password itself.

Markup: `<main class="mcg-login">` with `.mcg-login__main` (bar, body, foot) and the decorative `.mcg-login__art` panel. The consumer provides the sign-in handler (`authorize()` of the OIDC library), the language and theme state, and an optional notice derived from the URL or the auth state.

- Route `/login`, outside the authenticated shell, no top bar. An auth guard sends every signed-out request here and remembers the target route for after the callback.
- One primary button, "Anmelden" / "Sign in". It starts the authorization code flow with PKCE and redirects to the Cognito domain. No email or password fields on this page: credentials, MFA (TOTP) and password reset happen on the Cognito side.
- After the click, set the button to its loading label "Weiterleitung …" / "Redirecting …" and disable it, so a double click does not start two flows.
- Callback route `/auth/callback` shows only a centred Progress bar with "Anmeldung wird abgeschlossen" / "Completing sign-in", then navigates to the remembered route or `/`.
- Notices above the title (`.mcg-notice`): after sign-out "Du wurdest abgemeldet." / "You have been signed out." (`role="status"`). On a callback error or expired session use `mcg-notice--error`: "Die Anmeldung hat nicht geklappt. Bitte versuche es erneut." / "Sign-in did not work. Please try again." Never show raw error codes from Cognito.
- Language and theme switches sit top right, small, so the choice is made before signing in and carries over to the app.
- Footer line "Zugang nur auf Einladung." / "Access by invitation only." Self sign-up is disabled, so there is no "Create account" link.
- The art panel reuses the cover composition: the 48px module grid in `line`, blocks in `accent`, `ink`, `accent-soft` and the three person colors. Hidden below 900px. No photos, no illustrations.
- Style the Cognito managed login page to match where the branding options allow: `accent` for the primary button, `bg` and `surface` for the grounds, IBM Plex Sans, square corners, the myClaimGrid name instead of a logo.
