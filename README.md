# myClaimGrid

Web app to track health insurance claims for three persons. Release 1: create a claim from a PDF invoice (data is extracted, the user reviews and saves) or manually, and a dashboard per year and per person.

Everything runs in `eu-central-1` (Frankfurt). The documents contain health data, nothing leaves the EU. No bank data (IBAN, BIC, account numbers) is ever extracted, stored, shown or logged.

The full plan is in [myclaimgrid-setup-plan.md](myclaimgrid-setup-plan.md).

## Status

| Part                                 | State                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Infrastructure (CDK)                 | Done: synth and template tests pass. Not deployed.                                  |
| Backend (Lambda, DynamoDB, Textract) | Done: unit and handler tests pass.                                                  |
| Frontend (Angular 22)                | Done: login, dashboard, claim dialog, unit and Playwright tests pass. Not deployed. |
| CI/CD                                | Workflows and the OIDC role template are written. Not applied.                      |

## Layout

```
.github/workflows/   ci.yml (pull requests, no AWS access), deploy.yml (main, manual approval, OIDC)
infra/               CDK app. Stacks: frontend, storage, auth, api, frontend-deploy, ops
infra/bootstrap/     CloudFormation template for the GitHub OIDC role (applied once by you)
backend/             Lambda handlers, repository, extraction, tests
shared/              zod schemas of the API contract (used by backend and frontend)
frontend/            Angular app (standalone components, signals, Transloco, Cognito login on the landing page)
design-system/       The binding myClaimGrid design system
```

## Requirements

- Node.js 22.22.3 or newer on the 22 line, or 24.15 or newer (`.nvmrc` says 22). Angular 22 refuses older versions, so run `brew upgrade node` or similar if `ng` complains. CI uses the `.nvmrc` version.
- npm 10 or newer.
- AWS CLI with credentials for the manual steps below.

The repository lives in OneDrive. `node_modules`, `cdk.out`, `dist` and `.angular` are git-ignored but OneDrive still syncs them, which is slow and can produce conflicts. If that bothers you, move the folder out of OneDrive.

## Develop

```bash
npm ci
npm run lint          # ESLint
npm run format:check  # Prettier (npm run format fixes)
npm run typecheck     # includes the Angular templates (strict)
npm test              # shared, backend, frontend (Vitest), infra
npm run build         # shared, frontend (production), type checks
npm run csp:check     # the CSP hash of the inline theme script matches infra/csp-script-hashes.json
npm run synth         # cdk synth, bundles the Lambdas with esbuild, no AWS calls
npm run test:e2e      # Playwright against the "e2e" build (first run: npx playwright install chromium)
```

Backend, frontend and infra import the API contract from `shared`, which is built first. The root scripts do that in the right order.

**Frontend against a deployed backend:** after the first deployment copy [frontend/config.example.json](frontend/config.example.json) to `frontend/public/config.json` (git-ignored), fill in the stack outputs (API URL, region, user pool ID, client ID), then `npm run start -w frontend`. The login page signs in directly against the Cognito API, there is no redirect.

**Frontend without a backend:** `npm run start:e2e -w frontend` serves the app with a fake sign-in. The Playwright tests answer every API call themselves ([frontend/e2e/support.ts](frontend/e2e/support.ts)).

**After changing the theme script in `frontend/src/index.html`:** run `npm run build` and `npm run csp:write -w frontend`, and commit `infra/csp-script-hashes.json`. CI fails when they differ, because the CSP only allows that one inline script by hash.

## One-time AWS setup (you, not the agent or the pipeline)

Nothing below is run automatically. Use a dev or prod account of your choice.

1. **Bootstrap CDK** in the target account and region:
   ```bash
   cd infra
   npx cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1
   ```
2. **Create the GitHub OIDC role** with the template in [infra/bootstrap/github-oidc.yaml](infra/bootstrap/github-oidc.yaml):
   ```bash
   aws cloudformation deploy \
     --stack-name myclaimgrid-github-oidc \
     --template-file infra/bootstrap/github-oidc.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --region eu-central-1 \
     --parameter-overrides GitHubOwner=<your GitHub user or org> GitHubRepo=myClaimGrid
   ```
   If the account already has a GitHub OIDC provider, add `CreateOidcProvider=false` (only one can exist). The role can do nothing except assume the CDK bootstrap roles.
3. **Configure GitHub** (Settings, Environments, `prod`):
   - Required reviewers: yourself (the manual approval).
   - Deployment branches: only `main`. This is what limits the role to `main`, because the OIDC subject of an environment job does not contain the branch.
   - Variables: `AWS_DEPLOY_ROLE_ARN` (output of step 2), `ALERT_EMAIL` (receives the alarm and budget mails), optional `COGNITO_DOMAIN_PREFIX` (default is `myclaimgrid-<account id>`). These are variables, not secrets, and nothing account specific is committed.
4. **Deploy** by pushing to `main` and approving the `prod` environment. The first deployment confirms the alert subscription mail (SNS) and the budget.
5. **Create your user** (self sign-up is disabled). Use the user pool ID from the `myclaimgrid-auth` stack outputs:
   ```bash
   aws cognito-idp admin-create-user \
     --region eu-central-1 \
     --user-pool-id <USER_POOL_ID> \
     --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
     --desired-delivery-mediums EMAIL
   ```
   Optional: enable TOTP in the hosted UI after the first sign-in.

## Deployment and rollback

`deploy.yml` runs the same checks as `ci.yml`, then the `deploy` job waits for approval in the `prod` environment, assumes the role via OIDC, builds, and runs `cdk deploy --all`. The CDK app also uploads the frontend, writes `config.json` (API URL, user pool and client IDs, hosted UI URL) and invalidates CloudFront, so the pipeline has no extra deploy script.

- A failed deployment rolls back automatically through CloudFormation.
- To go back to an earlier version: Actions, Deploy, Run workflow, enter the commit SHA in `ref`, approve. The workflow checks out that commit and redeploys it. It still runs from `main`, so the environment rule holds.
- The DynamoDB table, the invoice bucket and the user pool are retained when a stack is deleted (health data). Deleting them is a manual decision.

## Architecture in short

- **Stack order** (avoids circular references): `frontend` (bucket and CloudFront) -> `storage` -> `auth` -> `api` -> `frontend-deploy` and `ops`. The CloudFront domain is created first because S3 CORS and the Cognito callback URLs need it.
- **API:** HTTP API with a Cognito JWT authorizer on every route. Four Lambdas (persons, claims, dashboard, extraction) with separate least-privilege roles. Logs are kept for 30 days.
- **Data:** one DynamoDB table (`pk`, `sk`) plus the index `byClaimId`. Persons live under `USER#<sub>`, claims under `PERSON#<id>`. Drafts use the sort key `CLAIM#DRAFT#<id>` and move to `CLAIM#<invoiceDate>#<id>` when saved. Amounts are integer cents.
- **Upload:** `POST /uploads` creates a draft and returns a presigned POST (PDF only, 10 MB, enforced by S3). The S3 event on `uploads/*.pdf` triggers the extraction Lambda, which calls Textract `AnalyzeExpense`, maps five fields, and writes the result to the draft. The frontend polls `GET /claims/{id}`.
- **Frontend:** Angular 22 (standalone components, signals, no zone.js), styles generated from `design-system/` (`npm run tokens`), texts in `de.json` and `en.json` (Transloco, switched at runtime), dates, numbers and currency formatted for `de-DE` or `en-GB`. `/login` sits outside the signed-in shell. Runtime settings come from `/config.json`, written by the CDK app at deploy time.
- **Extractor:** behind the `InvoiceExtractor` interface in [backend/src/extraction/extractor.ts](backend/src/extraction/extractor.ts), so Textract can be replaced (for example by a model on Bedrock) without touching anything else.

## Assumptions and decisions

These came up while building. Change them if you disagree.

- **Required claim fields:** provider, invoice date and amount (greater than zero). Invoice number and description are optional.
- **Person of a claim** cannot be changed after creation in release 1.
- **Seeding:** the first `GET /persons` creates "Person 1" to "Person 3" (idempotent, stable IDs). The dashboard only reads.
- **Saving a draft** before the extraction finished discards the late result (the status becomes `FAILED`, the user's data wins).
- **Amount parsing** is locale independent: `1.234,56`, `1,234.56`, `12,5`, `1234.56`. A single separator followed by exactly three digits is a thousands separator (`1.234` is 1234 euros). Malformed grouping returns "not recognised" instead of a guess.
- **Dates:** `12.03.2026`, `12.3.26`, `2026-03-12`, `12/03/2026` (day first) and `12. März 2026`.
- **Description** is never extracted. `AnalyzeExpense` has no reliable field for it.
- **Textract** is called synchronously and reads single-page PDFs only. Multi-page or unreadable files end as `FAILED` and the user enters the data manually. The asynchronous API is a later upgrade.
- **Bank data:** the extractor reads an allow list of five Textract types. Values that look like an IBAN are dropped even in an allowed field. Tests check that bank fields from the fixture never reach the database.
- **CSP:** the API, Cognito and S3 hosts are region wildcards (`*.execute-api.eu-central-1.amazonaws.com` and so on) because those hostnames do not exist when the distribution is created. Inline scripts are only allowed by hash (`infra/csp-script-hashes.json`, filled when the frontend exists). `style-src` allows `'unsafe-inline'` for Angular's runtime styles.
- **Deleted invoices:** versioning stays on, deleting an invoice adds a delete marker and noncurrent versions expire after 30 days.
- **Abandoned drafts** (browser closed during the dialog) keep their draft item and file. A cleanup job is a later task.
- **API throttling** is 10 requests per second, burst 20.
- **Sign-in on the landing page:** `/login` has the email and password form and talks to the Cognito API itself (`InitiateAuth` with `USER_PASSWORD_AUTH`, `RespondToAuthChallenge`, `ForgotPassword`, `ConfirmForgotPassword`, `RevokeToken`, code in [frontend/src/app/core/auth/cognito-core.ts](frontend/src/app/core/auth/cognito-core.ts)). The app client allows exactly `USER_PASSWORD_AUTH` and the refresh token flow. The password goes to Cognito over TLS and is not stored. SRP (password never sent) is not implemented. Steps on the page: sign in, new password (first sign-in of a user created with `admin-create-user`), authenticator code (users who already have TOTP), forgot password (code by mail). Cognito's error texts are never shown.
- **Not tested against a real user pool.** The flow is unit tested against a fake `fetch` and in the browser against a fake auth service. Check sign-in, the new-password step, token renewal and sign-out once after the first deployment.
- **No TOTP enrolment in the app.** The user pool allows TOTP (optional), but enabling it needs the hosted UI or the CLI. The code step only serves users who are already enrolled. Say if you want an enrolment screen in the settings.
- **The hosted UI is still deployed** (domain, OAuth code flow, callback URLs) but nothing in the app uses it. Removing it from [infra/lib/auth-stack.ts](infra/lib/auth-stack.ts) is a later cleanup.
- **Tokens:** the API gets the access token (Cognito puts the app client in `client_id`, the HTTP API JWT authorizer accepts that). The token is only sent to the API URL, never to S3. Access and refresh token are kept in `sessionStorage` (gone when the tab closes), renewed one minute before they expire, and the refresh token is revoked on sign-out.
- **Amounts in the form** are typed in the format of the active language (`1.234,56` or `1,234.56`). Ambiguous input such as `12.5` in German is rejected, not guessed.
- **Dates** are typed or picked in the date format of the settings (`dd.MM.yyyy`, `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`; default follows the language). ISO `2026-03-12` is always accepted. The calendar next to the field starts the week on Monday and opens on the typed date.
- **Settings** (`/settings`): names and Selbstbehalt of the three persons are saved to the account (`PUT /persons/{id}`, `deductible` in integer cents, 0 = none). Date and time format are kept in this browser like language and theme. The Selbstbehalt is yearly and the same for every year. The person card compares it with the total of all saved claims of the selected year (open claims count). There is no year-specific amount.
- **Time format:** stored and previewed in the settings, but the app shows no times yet, so it has no visible effect.
- **Cancel and Escape** delete the draft and its PDF after an upload. If the browser is closed instead, the draft stays (see above).
- **Localhost callback:** the Cognito client also allows `http://localhost:4200/` for `ng serve`. Remove it with `-c localCallback=false`.
- **Budget:** monthly cost budget with a default limit of 10 USD (`-c budgetLimitUsd=...`), mails at 80 percent actual and 100 percent forecast. It is only created when `ALERT_EMAIL` is set, and the deploy job refuses to run without it.
- **Test data:** the repository contains no real invoices. The extraction fixture is a synthetic, anonymized Textract response ([backend/test/fixtures/](backend/test/fixtures/)).
- **Toolchain:** TypeScript 6.0 (the version Angular 22 and typescript-eslint support), ESM everywhere, Vitest for shared, backend and the frontend logic, Playwright for the frontend flows, esbuild bundling through CDK.

## Design system gaps and deviations

The design system is binding. These are the places where the app had to go beyond it or differ from it:

- **Fonts are self-hosted** (`@fontsource`, latin subset) instead of loaded from Google Fonts: no visitor IPs to Google, closed CSP. The line in `design-system/README.md` was changed accordingly, and `bundle.css` is copied without its `@import`.
- **Two icons were missing:** `alert` (triangle) and `chevron-down` are drawn in the same style as the others (20px grid, 1.5px stroke, square caps). The sun, moon, monitor, upload, file, plus, close, sign-out, arrow and info paths come from the previews.
- **Top bar below 640px** wraps the tools onto a second row. Brand, year, language, theme and sign-out do not fit one 390px row, and the design system has no rule for it.
- **Invoice date label** is "Datum" / "Date" in the dialog (as in the Dialog preview), "Rechnungsdatum" does not fit next to the "Aus PDF" tag in the 40% column.
- **Theme switch** shows icons and labels on desktop and icons only below 640px, following the README text. The TopBar preview shows icons only.
- **Type styles** (`title-1`, `figure`, and so on) exist as `.mcg-type-<name>` classes generated from `tokens.json`, because `bundle.css` has none.
- **Top bar** has a Settings button between the theme switch and Sign out (the design system lists year, language, theme, sign out only). The settings page, the calendar popover and the Selbstbehalt bar are built from existing tokens and classes, they have no design-system preview yet.

## Open points

- Check the Textract quality on two or three real invoices before relying on it (German doctor invoices are often multi-page and itemized). If it is not good enough, replace the extractor.
- Retention rules for stored invoices (current versions).
- Git hosting: the pipeline assumes GitHub.
- The status workflow after release 1 (submitted, reimbursed, rejected).
