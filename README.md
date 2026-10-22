# Stripe Connect Marketplace Demo

This is a local Node.js and Express sample reconstructed from `StripeConnect_App_Source_Code.docx`. Express serves the frontend from `public/` and exposes Stripe operations under `/api`. The browser talks to those routes; secret keys stay on the server in `.env`.

## Requirements

- Node.js 18 or newer
- A Stripe account and API keys when you are ready to exercise Stripe features

## Run locally

1. Copy `.env.example` to `.env`. Keep the key values empty until you have them.
2. Install dependencies with `npm install`.
3. Start Express with `npm start` (or use `npm run dev` for the Vite frontend and Express API together).
4. Open `http://localhost:4242` when using `npm start`, or `http://localhost:3000` when using `npm run dev`.

The pages load without keys, but Stripe-backed actions require the matching test or live keys. Requests default to sandbox/test mode. Live redirects require `DOMAIN_LIVE` to be an HTTPS URL; localhost is accepted for test mode. Do not put secret keys in frontend files or commit `.env`.

## What the project does

- Creates Standard, Express, and Custom connected accounts and supports hosted and embedded onboarding.
- Reads account status and products, creates product prices, and creates Stripe Checkout sessions.
- Provides a sample storefront and a payment completion summary.
- Includes `/api/webhook` and `/api/thin-webhook` examples. Configure endpoint secrets in server code before relying on webhook signature verification.

## Main files

- `server.js`: Express app, environment selection, API endpoints, static serving, and webhook examples.
- `vite.config.js`: Vite development server, clean URL fallback, and API proxy.
- `public/index.html` and `public/connect.js`: account onboarding and Connect dashboard.
- `public/embedded-onboarding.*`: embedded onboarding flow.
- `public/store*.html` and related scripts: demo storefronts.
- `public/done.*`: Checkout completion page.
- `public/App.css`: shared styles.

## Environment variables

See `.env.example`. `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_PUBLISHABLE_KEY` are for test mode; the `STRIPE_LIVE_*` variables are for live mode. `DOMAIN` is the test redirect base URL, and `DOMAIN_LIVE` is the HTTPS live redirect base URL. `PORT` defaults to `4242`.
