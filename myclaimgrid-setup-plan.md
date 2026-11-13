# myClaimGrid: Project Setup Plan

## Goal

myClaimGrid is a web app to track health insurance claims for three persons. The first release covers two things:

1. Create a claim through a dialog, either by attaching a PDF invoice (the backend extracts the data, the user reviews and corrects it, then saves) or by entering the data manually without a PDF.
2. A dashboard that shows claims per year and per person.

Out of scope for release 1: submission workflow to the insurer, reimbursement matching, notifications, exports, multi-user sharing.

## Fixed decisions

- Region: eu-central-1 (Frankfurt). The documents contain health data, so nothing leaves the EU.
- Infrastructure as code: AWS CDK in TypeScript.
- Backend: API Gateway (HTTP API), Lambda (Node.js 22, TypeScript, esbuild bundling), DynamoDB (single table, on-demand), S3, Cognito, Textract.
- Frontend: Angular (current stable version, 22 at the time of writing, which needs TypeScript 6.0 and Node 22.22.3 or 24.15 or newer), standalone components, signals, strict TypeScript. Hosted on S3 behind CloudFront.
- Auth: Cognito user pool with self sign-up disabled. One user is created manually. All API routes require the JWT authorizer.
- Design: the myClaimGrid design system is binding (section "Design system" below). Square corners only, light and dark theme, no component library, plain SCSS with CSS custom properties, Angular CDK for the overlay and the focus trap.
- Product name in the UI: myClaimGrid. Technical names (repo, stacks, table, buckets) use the lowercase form `myclaimgrid`.
- Currency EUR. UI languages: German and English, switchable at runtime. Dates, numbers, and currency are formatted according to the active language.
- No bank account data is stored. IBAN, BIC, and account numbers are never extracted, saved in the database, shown in the UI, or logged. The stored PDF is the original document and may show bank details printed on the invoice, the app does not read or copy them.
- CI/CD: GitHub Actions with OIDC access to AWS, no long-lived access keys (details in Phase 5).

## Repository layout

Monorepo with npm workspaces. The repository root is this folder (`myClaimGrid`, a new git repository, remote on GitHub). The folder lives in OneDrive: `.gitignore` must cover `node_modules`, `cdk.out`, `dist`, `.angular`, and the README notes that these folders sync slowly.

```
myClaimGrid/
  .github/workflows/ CI and deploy pipelines
  infra/            CDK app (stacks: Storage, Auth, Api, Frontend, FrontendDeploy)
  backend/          Lambda handlers, domain code, tests
  shared/           zod schemas and types of the API contract, used by backend and frontend
  frontend/         Angular app
  design-system/    Already present (README, tokens.json, component READMEs and previews)
  package.json      workspaces, shared scripts
  README.md
```

## Phase 0: Bootstrap

- Initialize the repo, workspaces, ESLint, Prettier, and a shared tsconfig base.
- Create the CDK app in `infra/`. Set the default environment to eu-central-1. Document `cdk bootstrap` as a manual step for the user, do not run it without asking.
- Add a root `README.md` with setup, deploy, and local dev instructions.

Done when: `npm run build` passes in all workspaces and `cdk synth` produces templates.

## Phase 1: Infrastructure

**Stack order and dependencies** (avoids circular references): Frontend (bucket and distribution only) -> Storage (CORS uses the CloudFront domain) -> Auth (callback URLs use the CloudFront domain) -> Api -> FrontendDeploy (`BucketDeployment` with the generated `config.json` and invalidation, uses the outputs of Auth and Api). The S3 notification to the extraction Lambda is defined in the ApiStack against the bucket imported by attributes.

**StorageStack**

- S3 bucket `invoices` with block public access, SSE-S3 encryption, versioning on, enforce TLS, CORS for the frontend origin (POST, GET).
- Lifecycle rule: expire noncurrent versions after 30 days, so deleted invoices do not stay forever. Retention of current invoices is the user's decision.
- DynamoDB table `myclaimgrid` (on-demand, PITR on), partition key `pk`, sort key `sk`, and GSI `byClaimId` (`gsi1pk` = `CLAIM#<claimId>`, projection ALL).

**AuthStack**

- Cognito user pool, no self sign-up, email as username, MFA optional (TOTP).
- App client for the SPA (authorization code flow with PKCE, no secret). Callback URL `<origin>/auth/callback`, sign-out URL `<origin>/login` (the routes of the design system's LoginPage), for the CloudFront origin and for `http://localhost:4200`.

**ApiStack**

- HTTP API with JWT authorizer from the user pool.
- Lambda functions per route group, each with least-privilege IAM.
- S3 event notification on `uploads/` prefix (ObjectCreated) triggering the extraction Lambda.
- IAM for Textract (`textract:AnalyzeExpense`) on the extraction Lambda.

**FrontendStack**

- Private S3 bucket for the Angular build, CloudFront distribution with origin access control, SPA fallback to `index.html`, security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors none).
- CSP allows: `connect-src` for the API, the Cognito domain, and the S3 regional endpoint (presigned POST); `frame-src` and `object-src` for the S3 endpoint (PDF preview); `script-src 'self'` plus the hash of the theme script; fonts and images from `'self'`. Angular inline styles: set `inlineCritical: false` in the build, and allow `style-src 'unsafe-inline'` unless Angular's CSP hash support works in the chosen version. State the result in the README.
- The `config.json` (CloudFront URL, API URL, user pool ID, client ID) is generated by the FrontendDeploy stack at deploy time, not from build-time environment files.

Done when: all stacks deploy to a dev account and a test user can sign in via the Cognito hosted UI.

## Phase 2: Data model

Single-table design. Three persons are stored as entities so names can be edited.

| Entity        | pk                  | sk                              | Main attributes |
| ------------- | ------------------- | ------------------------------- | --------------- |
| Person        | `USER#<sub>`        | `PERSON#<personId>`             | name, color     |
| Claim (draft) | `PERSON#<personId>` | `CLAIM#DRAFT#<claimId>`         | see below       |
| Claim (saved) | `PERSON#<personId>` | `CLAIM#<invoiceDate>#<claimId>` | see below       |

A claim is found by `claimId` through GSI `byClaimId` (`gsi1pk = CLAIM#<claimId>`), which the API handlers and the extraction Lambda use. Drafts have no invoice date, so they sit under `CLAIM#DRAFT#` and never appear in year queries. On save, the item is moved to the dated sort key with a DynamoDB transaction (delete and put). The same happens when the invoice date is edited later.

Claim attributes: `claimId`, `personId`, `year` (derived from invoice date), `provider` (doctor or hospital), `invoiceNumber`, `invoiceDate`, `amount` (integer cents), `currency`, `description`, `status` (`DRAFT`, `OPEN`), `source` (`EXTRACTED` or `MANUAL`), `s3Key` (optional, empty for manual claims), `extraction` (only the mapped fields plus confidence values, no raw OCR output), `createdAt`, `updatedAt`. There is no field for bank data, and the zod schemas reject unknown fields.

Access patterns for release 1:

- List claims for a person and year: query `pk = PERSON#id`, `sk between CLAIM#<year>-01-01 and CLAIM#<year>-12-31~`.
- Dashboard totals: query the same range per person and aggregate in the Lambda. Volumes are small, no extra aggregates needed. Drafts are not counted. The list of years comes from a query over `sk between CLAIM#0000 and CLAIM#9999~` with a projection on `sk`.
- Persons for the logged-in user: query `pk = USER#sub`, `sk begins_with PERSON#`.

Seed the three persons lazily inside `GET /persons` if none exist, using conditional writes so it is idempotent. No extra route and no custom resource.

## Phase 3: Backend API

All handlers are validated with zod. Money is always integer cents. Every handler checks that the person belongs to the authenticated user.

| Method | Route                        | Purpose                                                                                                                                                                                                                                                                |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/persons`                   | List persons                                                                                                                                                                                                                                                           |
| PUT    | `/persons/{id}`              | Rename a person                                                                                                                                                                                                                                                        |
| POST   | `/uploads`                   | Create a claim in `DRAFT` with source `EXTRACTED`, return a presigned POST (URL and form fields) for `uploads/<userSub>/<claimId>.pdf` with conditions: content type application/pdf, `content-length-range` up to 10 MB. A presigned PUT cannot enforce a size limit. |
| POST   | `/claims`                    | Create a claim manually without a PDF (source `MANUAL`, status `OPEN`)                                                                                                                                                                                                 |
| GET    | `/claims/{id}`               | Get one claim including extraction state and a presigned GET URL for the PDF                                                                                                                                                                                           |
| PUT    | `/claims/{id}`               | Save the corrected data, set status to `OPEN`                                                                                                                                                                                                                          |
| DELETE | `/claims/{id}`               | Delete claim and S3 object (if one exists)                                                                                                                                                                                                                             |
| GET    | `/persons/{id}/claims?year=` | List claims for a person and year                                                                                                                                                                                                                                      |
| GET    | `/dashboard?year=`           | Per person: count and sum of claims for the year, plus the list of years that have data                                                                                                                                                                                |

**Extraction Lambda** (triggered by S3):

1. Load the PDF (check size and the `%PDF` header, otherwise set `FAILED`), call the synchronous Textract `AnalyzeExpense` with the bytes. It supports single-page PDFs only: multi-page or unsupported documents end as `FAILED` and the user enters the data manually. The asynchronous API is a later upgrade, not part of release 1. Any error in the Lambda must set `FAILED`, never leave `PENDING`.
2. Map the result to the claim fields: provider, invoice number, invoice date, total amount, optional description. Ignore everything else. Bank details are never mapped, stored, or logged, and the raw Textract response is discarded after mapping.
3. Write the result to the claim item with `extractionStatus` (`PENDING`, `DONE`, `FAILED`). Missing fields stay empty, they are never guessed.
4. Keep the extractor behind an interface (`InvoiceExtractor`) so the implementation can be swapped without touching the rest.

Textract limits: check the current limits for synchronous `AnalyzeExpense` (page count, size, supported languages including German) and document them in the README.

Tests: unit tests for the mapping and the date and amount parsing (German formats like `1.234,56` and `12.03.2026`), handler tests with mocked AWS clients (aws-sdk-client-mock), and a small set of anonymized sample PDFs under `backend/test/fixtures`. Do not commit real invoices.

## Design system

The design system "myClaimGrid" is the single source for everything visual. A copy is already in the repository as `design-system/`. Before writing any frontend code, read `design-system/README.md`, `design-system/tokens.json`, and the README and `preview.html` of each component.

**Tokens**

- Generate `frontend/src/styles/tokens.scss` from `design-system/tokens.json` with a small Node script (`npm run tokens`), run before `ng build` and `ng serve`. Output: CSS custom properties named exactly as in the file (`--surface`, `--space-4`, `--radius`, `--font-sans`, `--font-mono`). Light values on `:root`, dark values on `:root[data-theme="dark"]`. Aliases such as `focus` resolve to `var(--accent)`.
- Do not hand-edit the generated file and do not add colors, spacings, or radii that are not in the tokens. If something is missing, add the smallest token or component needed to `design-system/` and list it in the README under "Design system gaps".

**Styles and components**

- Base styles come from `design-system/components/bundle.css`, copied into the Angular global styles with the `mcg-` classes unchanged. Remove its Google Fonts `@import`, fonts are handled as described below. Also change the line in `design-system/README.md` that says to load the fonts from Google Fonts, so it matches the self-hosting decision.
- The components in the design system are static HTML. Port each one 1:1 into an Angular standalone component with the same markup and classes: Button, Field, Select, SegmentedControl, Dropzone, Dialog, Progress, StatusBadge, TopBar, PersonCard, ClaimTable, EmptyState, LoginPage. The `Notice` styles (`mcg-notice`) in `bundle.css` are used by the LoginPage and can be used for other messages. The `Cover` component is only a brand cover for the design system and is not ported. Use the `preview.html` of each as the reference.
- Square corners everywhere, no shadows except `shadow-overlay` on the dialog and menus, tabular numbers for all amounts, focus ring `2px solid var(--focus)` on every interactive element, transitions disabled under `prefers-reduced-motion`.

**Theme**

- Three states: Light, System, Dark. System follows `prefers-color-scheme` live. The choice is stored in `localStorage` under `mcg.theme` (try/catch, fallback System).
- Set `data-theme` on `<html>` with a small inline script in `index.html` before Angular boots, so the page never flashes. Allow this script in the CSP via a hash, not `unsafe-inline`.

**Fonts**

- Self-host IBM Plex Sans (400, 500, 600) and IBM Plex Mono (400, 500) through the `@fontsource` packages, with `font-display: swap`. This deviates from the README line that says to load them from Google Fonts. The families and weights are identical. The reason is that hotlinking Google Fonts transfers visitor IP addresses to Google, which is a data protection problem under GDPR, and it keeps the CSP closed to external hosts.

**Content**

- All copy lives in `de.json` and `en.json` and follows the tone and vocabulary of the design system README (informal German, "Rechnung" for a claim in German, status words, "Nicht erkannt" for empty extracted fields).
- Icons: the design system defines none yet. Use inline SVG line icons on a 20px grid, 1.5px stroke, square caps and miter joins, `currentColor`. Needed in release 1: upload, PDF file, plus, close, chevron down, sun, moon, monitor, sign out, alert, arrow right (sign-in button), info (notice). The paths used in the previews of Button, TopBar and LoginPage are the reference.
- No component, label, placeholder, or example shows IBAN, BIC, or account numbers.

## Phase 4: Frontend

**Foundation**

- Angular standalone app with routing and lazy-loaded feature routes.
- Auth via Cognito (authorization code flow with PKCE). Use a maintained OIDC library such as `angular-auth-oidc-client`. Add an HTTP interceptor for the bearer token.
- Design tokens and base styles come from the design system, see the section "Design system". Build the shared components first, then the features.
- Layout: top bar with product name, year selector, language switch, theme toggle, and sign-out. Content area below.
- i18n with Transloco (runtime language switching). Translation files `de.json` and `en.json`, no hardcoded UI text. Default language from the browser, manual choice persisted. Format dates, numbers, and currency with the active locale (`de-DE` or `en-GB`), register the locale data, and use explicit date formats (`dd.MM.yyyy` and `dd/MM/yyyy`) because the built-in `shortDate` shows a two-digit year. Parsing of extracted values stays locale independent on the backend. The amount input in the form needs a locale-aware `parseAmount(input, locale)` that returns integer cents (`1.234,56` in German, `1,234.56` in English), with unit tests.

**Sign-in** (`/login`, `/auth/callback`)

Follow `design-system/components/LoginPage/README.md`.

- `/login` and `/auth/callback` sit outside the authenticated shell (no top bar). Every other route is behind an auth guard that sends signed-out requests to `/login` and remembers the target route for after the callback.
- LoginPage: one primary button "Anmelden" / "Sign in" that calls `authorize()` of the OIDC library (authorization code flow with PKCE). After the click the button shows "Weiterleitung …" / "Redirecting …" and is disabled. No email or password fields, no sign-up link, footer "Zugang nur auf Einladung." / "Access by invitation only.". The decorative art panel is hidden below 900px.
- Language and theme switches are on the page, so both services must work before sign-in and carry over to the app.
- Callback: only a centred Progress bar with "Anmeldung wird abgeschlossen" / "Completing sign-in", then navigate to the remembered route or `/`.
- Notices (`mcg-notice`) above the title: after sign-out "Du wurdest abgemeldet." / "You have been signed out." (`role="status"`). Before redirecting to the Cognito logout endpoint the app stores a flag in `sessionStorage` (try/catch), `/login` shows the notice once and clears it. After a callback error or when the session cannot be renewed, show the error variant "Die Anmeldung hat nicht geklappt. Bitte versuche es erneut." / "Sign-in did not work. Please try again.". Never show raw Cognito error codes.
- `redirect_uri` is `<origin>/auth/callback` and the logout redirect is `<origin>/login`, matching the Cognito app client in the AuthStack. Token renewal uses the refresh token, a failed renewal leads to `/login` with the error notice.
- The Cognito sign-in, MFA and password reset pages are styled in the Cognito branding editor where its options allow (accent for the primary button, `bg` and `surface` grounds, IBM Plex Sans, square corners, the name myClaimGrid instead of a logo). This is a manual step after the first deployment and not part of the CDK app in release 1, because the branding settings cannot be verified without a deployed user pool.

**Dashboard** (`/`)

- Year selector (defaults to the current year, lists years with data).
- One column per person, three columns from 1024px and stacked below. Each column has a PersonCard (number of claims, total invoice amount, person color bar) and a ClaimTable (date, provider, invoice number, amount, status) for the selected year. The person colors default to `person-1` to `person-3` and are stored on the person.
- Row click opens the claim in the review dialog.
- Empty state with a clear call to create the first claim.
- Button "New claim".

**New claim dialog**

1. Choose the person (required) and the entry mode, "Upload PDF" or "Enter manually". For the upload mode, attach a PDF (file picker and drag and drop, PDF only, 10 MB).
2. On submit: call `POST /uploads`, upload the file directly to S3 with the presigned POST (multipart form, file field last), then poll `GET /claims/{id}` until `extractionStatus` is `DONE` or `FAILED` (poll every 1.5 s, timeout after 60 s).
3. Review step: form on the left (provider, invoice number, invoice date, amount, description), PDF preview on the right via the presigned GET URL in an embedded viewer. Fields that were extracted are prefilled, empty ones are marked. If extraction failed, the form is empty and the user fills it manually.
4. Save sends `PUT /claims/{id}`. The dashboard refreshes.
5. Manual mode skips steps 2 and 3. The form opens empty without PDF preview, and save sends `POST /claims`. The dashboard refreshes.

- Cancel on any step deletes the draft claim and the file. If the user has edited fields, ask once before discarding.
- Build the dialog from the Dialog, Dropzone, Field, Select, SegmentedControl, Progress, and StatusBadge components. Steps and footer follow the Dialog README. Opening an existing claim from the table reuses the review step with the title "Rechnung bearbeiten" / "Edit claim" and a delete button.
- Use reactive forms with validation (required fields, valid date, amount greater than zero). The form has no bank account fields.

**Quality**

- Accessible dialog (focus trap, escape closes, labels on all fields), keyboard usable.
- Unit tests for the form logic and the amount and date formatting, a test that `de.json` and `en.json` contain the same keys, and Playwright tests for both happy paths (upload and manual) against a mocked API, plus the sign-in flow: a signed-out request lands on `/login`, the button starts the sign-in and disables itself, the callback shows the progress bar and returns to the remembered route, the signed-out and error notices appear, and no password field exists. The e2e build replaces the OIDC auth service with a fake one through a DI token, so the tests do not depend on Cognito.

Done when: a user can sign in through the login page and the Cognito hosted UI, create a claim either with a PDF (and correct the extracted data) or manually, switch the language, and see the claim on the dashboard under the right person and year. The UI matches the design system previews in both themes.

## Phase 5: CI/CD and operations

**Pipeline (GitHub Actions)**

- `ci.yml` runs on every pull request: `npm ci`, lint, typecheck, unit tests for backend and frontend, production build of the frontend, `cdk synth`, Playwright tests. The PR job has no AWS credentials.
- `deploy.yml` runs on push to `main`. It repeats the checks, then a deploy job runs in the GitHub environment `prod` with a required manual approval. The job assumes an AWS role via OIDC, builds the frontend, and runs `cdk deploy --all`.
- The frontend upload, the generated `config.json`, and the CloudFront invalidation are part of the CDK app (`BucketDeployment` with the stack outputs), so the pipeline needs no extra deploy script.
- The OIDC identity provider and the deploy role (trust limited to this repository, the `main` branch, and the `prod` environment) are created once by the user. The agent provides the template in `infra/bootstrap/` and documents the steps, but does not apply it.
- Pin third-party actions to a full commit SHA. Add Dependabot for npm and GitHub Actions.
- Failed deployments roll back through CloudFormation. Document how to roll back to an earlier commit by re-running the deploy workflow.

**Operations**

- CloudWatch log retention set to 30 days on all Lambdas. Alarm on extraction Lambda errors.
- Do not log invoice contents or personal data. Log claim IDs only.
- Cost guard: AWS Budget with an alert at a low monthly threshold.

## Working rules for the agent

- Work phase by phase and run build and tests at the end of each phase.
- Do not deploy, bootstrap CDK, create AWS resources, or create the pipeline role without explicit confirmation from the user. Deployments run through the pipeline.
- Never commit secrets, real invoices, or account IDs. Use context values or environment variables.
- If a decision is missing, pick the simpler option, state the assumption in the README, and continue.

## Open points for the user

- Whether Textract delivers good enough results on the real invoices. This should be checked with two or three real PDFs right after Phase 3. If not, replace the extractor implementation, for example with a model on Bedrock.
- Retention rules for stored invoices (current versions). Noncurrent versions expire after 30 days.
- Abandoned drafts (browser closed during the dialog) keep their draft item and file in release 1. A cleanup job is a later task.
- Execution: two runs. Run 1 covers phases 0 to 3 and 5 (everything except the frontend). Run 2 covers phase 4.
- Git hosting. The pipeline assumes GitHub. If the repository lives elsewhere, the workflows need to be adapted.
- The status workflow after release 1 (submitted, reimbursed, rejected).
- Styling of the Cognito managed login pages in the Cognito branding editor after the first deployment (see "Sign-in" in Phase 4). Codifying it in CDK is possible later.
