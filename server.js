require("dotenv").config();
// Keys live in .env (gitignored). See https://docs.stripe.com/keys-best-practices.
//
// Stripe has no API call that "switches" an account between sandbox and live —
// mode is entirely determined by which secret key you call the API with. So the
// Sandbox/Live toggle in the UI works by sending an `X-Stripe-Env` header on every
// request, and the server picks the matching Stripe client (test or live key) for
// that request. See the `resolveStripeClient` middleware below.
const Stripe = require("stripe");
// Let the frontend run before credentials are supplied. Stripe clients are
// created only for configured keys; Stripe-backed API routes report setup
// guidance below while the static pages remain available.
const stripeTest = process.env.STRIPE_TEST_SECRET_KEY
  ? Stripe(process.env.STRIPE_TEST_SECRET_KEY)
  : null;
const stripeLive = process.env.STRIPE_LIVE_SECRET_KEY
  ? Stripe(process.env.STRIPE_LIVE_SECRET_KEY)
  : null;
// Back-compat alias: used by the raw webhook handlers below, which aren't
// wired to the sandbox/live toggle.
const stripe = stripeTest;
const express = require("express");
const path = require("path");
const app = express();
const router = express.Router();
app.use(express.static("public"));

// success_url points here (see /api/create-checkout-session and
// /api/create-store-checkout-session). express.static only serves exact
// filenames, so /done (no .html) needs its own route.
app.get("/done", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "done.html"));
});

// // Thin webhook must see the raw body before any JSON/urlencoded parsers run
app.post(
  "/api/thin-webhook",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    // Replace this endpoint secret with your endpoint's unique secret
    // If you are testing with the CLI, find the secret by running 'stripe listen'
    // If you are using an endpoint defined with the API or dashboard, look in your webhook settings
    // at https://dashboard.stripe.com/webhooks
    const thinEndpointSecret = "";
    const signature = request.headers["stripe-signature"];
    if (!stripe) {
      return response.status(503).json({ error: "Set STRIPE_TEST_SECRET_KEY in .env to enable webhooks." });
    }
    let eventNotif;
    try {
      eventNotif = stripe.parseEventNotification(
        request.body,
        signature,
        thinEndpointSecret
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`, err.message);
      return response.sendStatus(400);
    }

    if (eventNotif.type === "v2.account.created") {
      await eventNotif.fetchRelatedObject();
      await eventNotif.fetchEvent();
    } else {
      console.log(`Unhandled event type ${eventNotif.type}.`);
    }

    response.send();
  }
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Resolve which Stripe client (sandbox/test or live) this request should use.
// The frontend sends `X-Stripe-Env: sandbox` or `X-Stripe-Env: live` based on
// the toggle state; anything else (or missing) defaults to sandbox, so the
// app is safe-by-default.
router.use((req, res, next) => {
  // Fetch calls send the header; the plain HTML storefront checkout form
  // (native browser POST, no custom headers) sends a hidden `env` field
  // instead; a `?env=` query param covers plain links (e.g. return_url).
  const requestedEnv = req.header("X-Stripe-Env") || req.body?.env || req.query?.env;
  const env = requestedEnv === "live" ? "live" : "sandbox";
  req.stripeEnv = env;
  req.stripe = env === "live" ? stripeLive : stripeTest;
  if (!req.stripe && req.path !== "/config") {
    const keyName = env === "live" ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY";
    return res.status(503).json({ error: `Stripe is not configured. Set ${keyName} in .env to enable this action.` });
  }
  next();
});

// Stripe requires every live-mode redirect URL (Account Links, Checkout
// success/cancel) to be HTTPS — http://localhost is only accepted in test
// mode. So sandbox keeps using DOMAIN (localhost is fine there); live uses
// DOMAIN_LIVE, which must point at an HTTPS tunnel (e.g. `ngrok http 4242`)
// when developing locally.
function getDomain(req) {
  return req.stripeEnv === "live" ? process.env.DOMAIN_LIVE : process.env.DOMAIN;
}

// Create a sample product and return a price for it
router.post("/create-product", async (req, res) => {
  const productName = req.body.productName;
  const productDescription = req.body.productDescription;
  const productPrice = req.body.productPrice;
  const accountId = req.body.accountId; // Get the connected account ID

  try {
    // Create the product on the connected account
    const product = await req.stripe.products.create(
      {
        name: productName,
        description: productDescription,
      },
      { stripeAccount: accountId }
    );

    // Create a price for the product on the connected account
    const price = await req.stripe.prices.create(
      {
        product: product.id,
        unit_amount: productPrice,
        currency: "usd",
      },
      { stripeAccount: accountId }
    );

    res.json({
      productName: productName,
      productDescription: productDescription,
      productPrice: productPrice,
      priceId: price.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extra create-time params per onboarding type, using the classic (v1)
// Connect Accounts API. Standard accounts are left to configure their own
// capabilities during hosted onboarding; Express/Custom get capabilities
// requested upfront so the demo can show charges/payouts status right away.
const ACCOUNT_TYPE_OPTIONS = {
  standard: {},
  express: {
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  },
  custom: {
    country: "US",
    business_type: "company",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  },
};

// Create a Connected Account
router.post("/create-connect-account", async (req, res) => {
  const accountType = req.body.accountType || "standard";
  const options = ACCOUNT_TYPE_OPTIONS[accountType];

  if (!options) {
    return res.status(400).json({
      error: `Invalid accountType "${accountType}". Expected one of: ${Object.keys(ACCOUNT_TYPE_OPTIONS).join(", ")}`,
    });
  }

  try {
    const account = await req.stripe.accounts.create({
      type: accountType,
      email: req.body.email,
      ...options,
    });

    res.json({ accountId: account.id, accountType });
  } catch (err) {
    console.error(`[${req.stripeEnv}] Error creating connect account:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stripe-hosted (Express) onboarding: create the account and its onboarding
// Account Link in a single round trip, then hand back the URL to redirect to.
router.post("/create-express-account", async (req, res) => {
  const { email } = req.body;

  try {
    // 1) Create the account
    const account = await req.stripe.accounts.create({
      type: "express",
      email,
      ...ACCOUNT_TYPE_OPTIONS.express,
    });

    // 2) Create the Account Link for that account. refresh_url sends them
    // back to the dashboard if the link itself expires mid-flow; return_url
    // (used once onboarding is complete/exited) sends them to the fake
    // storefront so they can immediately test a payment into this account.
    const accountLink = await req.stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      refresh_url: `${getDomain(req)}/?accountId=${account.id}&accountType=express`,
      return_url: `${getDomain(req)}/store.html?accountId=${account.id}&env=${req.stripeEnv}`,
    });

    res.json({ accountId: account.id, url: accountLink.url });
  } catch (err) {
    console.error(`[${req.stripeEnv}] Error creating express account:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create Account Link for onboarding
router.post("/create-account-link", async (req, res) => {
  const accountId = req.body.accountId;
  try {
    const accountLink = await req.stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${getDomain(req)}/?accountId=${accountId}`,
      return_url: `${getDomain(req)}/?accountId=${accountId}`,
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Connected Account Status
router.get("/account-status/:accountId", async (req, res) => {
  try {
    const account = await req.stripe.accounts.retrieve(req.params.accountId);

    res.json({
      id: account.id,
      payoutsEnabled: account.payouts_enabled,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
      requirements: account.requirements?.currently_due,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publishable key for the browser, matching the sandbox/live env of this
// request. Embedded onboarding (Connect embedded components) runs
// client-side via @stripe/connect-js, which needs the publishable key —
// unlike the rest of this app, which only ever uses the secret key server-side.
router.get("/config", (req, res) => {
  const publishableKey =
    req.stripeEnv === "live"
      ? process.env.STRIPE_LIVE_PUBLISHABLE_KEY || ""
      : process.env.STRIPE_TEST_PUBLISHABLE_KEY || "";
  res.json({ publishableKey, env: req.stripeEnv });
});

// Embedded onboarding: create an Account Session scoped to this account with
// the account_onboarding component enabled. The client_secret is short-lived
// and single-use — never persist it, just hand it straight to Connect.js.
router.post("/create-account-session", async (req, res) => {
  const { accountId } = req.body;
  try {
    const accountSession = await req.stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
      },
    });
    res.json({ clientSecret: accountSession.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login link for the Express Dashboard. Express connected accounts have no
// username/password — in sandbox, connect.stripe.com/express_login doesn't
// work at all (live mode only), so this single-use, short-lived link is the
// only way in. Only valid for accounts using the Express Dashboard.
router.get("/login-link/:accountId", async (req, res) => {
  try {
    const loginLink = await req.stripe.accounts.createLoginLink(req.params.accountId);
    res.json({ url: loginLink.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch products for a specific account
router.get("/products/:accountId", async (req, res) => {
  const { accountId } = req.params;

  try {
    const options = {};
    // If accountId is not 'platform', fetch from connected account
    if (accountId !== "platform") {
      options.stripeAccount = accountId;
    }

    const prices = await req.stripe.prices.list(
      {
        expand: ["data.product"],
        active: true,
        limit: 100,
      },
      options
    );

    res.json(
      prices.data.map((price) => ({
        id: price.product.id,
        name: price.product.name,
        description: price.product.description,
        price: price.unit_amount,
        priceId: price.id,
        period: price.recurring ? price.recurring.interval : null,
        image: "https://i.imgur.com/6Mvijcm.png",
      }))
    );
  } catch (err) {
    console.error("Error fetching prices:", err);
    res.status(500).json({ error: err.message });
  }
});


// Create checkout session
router.post("/create-checkout-session", async (req, res) => {
  const { priceId, accountId } = req.body;

  // Get the price's type from Stripe
  const price = await req.stripe.prices.retrieve(priceId, {
    stripeAccount: accountId, // Retrieve price from the connected account
  });
  const priceType = price.type;
  const mode = priceType === 'recurring' ? 'subscription' : 'payment';

  const session = await req.stripe.checkout.sessions.create({
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: mode,
    // Defines where Stripe will redirect a customer after successful payment
    success_url: `${getDomain(req)}/done?session_id={CHECKOUT_SESSION_ID}&accountId=${accountId}`,
    // Defines where Stripe will redirect if a customer cancels payment
    cancel_url: `${getDomain(req)}`,
  }, {
    stripeAccount: accountId
  });

  // Redirect to the Stripe hosted checkout URL
  res.redirect(303, session.url);
});

// Fake storefront checkout for a fixed T-Shirt product: 10.99 EUR in
// sandbox, 1 EUR in live (kept cheap since live charges are real money).
// Created as a direct charge on the connected account (stripeAccount
// option), so the connected account is the merchant of record and receives
// the funds.
const T_SHIRT_PRICE = {
  sandbox: 1099,
  live: 100,
};

router.post("/create-store-checkout-session", async (req, res) => {
  const { accountId } = req.body;

  try {
    const session = await req.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "eur",
              unit_amount: T_SHIRT_PRICE[req.stripeEnv],
              product_data: {
                name: "T-Shirt",
                images: ["https://i.imgur.com/6Mvijcm.png"],
              },
            },
            quantity: 1,
          },
        ],
        // payment_method_types intentionally omitted so Checkout shows the
        // payment methods relevant to the eur currency automatically.
        success_url: `${getDomain(req)}/done?session_id={CHECKOUT_SESSION_ID}&accountId=${accountId}`,
        cancel_url: `${getDomain(req)}/store.html?accountId=${accountId}`,
      },
      { stripeAccount: accountId }
    );

    res.redirect(303, session.url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment + fee breakdown for the confirmation page. accountId is required
// because this was a direct charge on the connected account (stripeAccount
// option), so the session/charge/balance transaction all live there, not
// on the platform account.
router.get("/checkout-session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { accountId } = req.query;

  if (!accountId) {
    return res.status(400).json({ error: "Missing accountId query param" });
  }

  try {
    const session = await req.stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["payment_intent.latest_charge.balance_transaction"] },
      { stripeAccount: accountId }
    );

    const charge = session.payment_intent?.latest_charge;
    const balanceTransaction = charge?.balance_transaction;

    res.json({
      accountId,
      paymentStatus: session.payment_status,
      currency: session.currency,
      amountTotal: session.amount_total,
      paymentMethodTypes: session.payment_method_types,
      cardBrand: charge?.payment_method_details?.card?.brand || null,
      cardLast4: charge?.payment_method_details?.card?.last4 || null,
      // Stripe's processing fee, taken out of the connected account's
      // balance since this is a direct charge (no application fee set).
      stripeFee: balanceTransaction?.fee ?? null,
      netAmount: balanceTransaction?.net ?? null,
      feeCurrency: balanceTransaction?.currency ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (request, response) => {
    if (!stripe) {
      return response.status(503).json({ error: "Set STRIPE_TEST_SECRET_KEY in .env to enable webhooks." });
    }
    let event = request.body;
    // Replace this endpoint secret with your endpoint's unique secret
    // If you are testing with the CLI, find the secret by running 'stripe listen'
    // If you are using an endpoint defined with the API or dashboard, look in your webhook settings
    // at https://dashboard.stripe.com/webhooks
    const endpointSecret = "";

    // Only verify the event if you have an endpoint secret defined.
    // Otherwise use the basic event deserialized with JSON.parse
    if (endpointSecret) {
      const signature = request.headers["stripe-signature"];
      try {
        event = stripe.webhooks.constructEvent(
          request.body,
          signature,
          endpointSecret
        );
      } catch (err) {
        console.log(`⚠️  Webhook signature verification failed.`, err.message);
        return response.sendStatus(400);
      }
    }

    let stripeObject;
    let status;
    // Handle the event
    switch (event.type) {
      case "checkout.session.completed":
        stripeObject = event.data.object;
        status = stripeObject.status;
        console.log(`Checkout Session status is ${status}.`);
        // Then define and call a method to handle the subscription deleted.
        // handleCheckoutSessionCompleted(stripeObject);
        break;
      case "checkout.session.async_payment_failed":
        stripeObject = event.data.object;
        status = stripeObject.status;
        console.log(`Checkout Session status is ${status}.`);
        // Then define and call a method to handle the subscription deleted.
        // handleCheckoutSessionFailed(stripeObject);
        break;

      default:
        // Unexpected event type
        console.log(`Unhandled event type ${event.type}.`);
    }
    // Return a 200 response to acknowledge receipt of the event
    response.send();
  }
);

app.use("/api", router);

// Heroku (and most PaaS hosts) assign the port dynamically via $PORT and
// route external HTTPS traffic to it — falls back to 4242 for local dev.
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
