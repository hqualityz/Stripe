// Embedded onboarding (embedded-onboarding.html): mounts Stripe's
// account-onboarding Connect embedded component for a single connected
// account. Reached via the "Start onboarding" button in the Embedded column
// on the dashboard, which passes ?accountId=...

const urlParams = new URLSearchParams(window.location.search);
const accountId = urlParams.get("accountId");
// Sandbox/Live env carried over from the dashboard's toggle (see connect.js),
// so this account session is created against the matching Stripe client.
const stripeEnv = urlParams.get("env") === "live" ? "live" : "sandbox";

const loadingEl = document.getElementById("onboarding-loading");
const errorEl = document.getElementById("onboarding-error");
const containerEl = document.getElementById("embedded-onboarding-container");

function showError(message) {
  loadingEl.classList.add("hidden");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function fetchClientSecret() {
  const response = await fetch("/api/create-account-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Stripe-Env": stripeEnv },
    body: JSON.stringify({ accountId }),
  });

  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error || "Failed to create account session");
  }

  const { clientSecret } = await response.json();
  return clientSecret;
}

function mountOnboarding(publishableKey) {
  try {
    // Loaded via the plain <script src="https://connect-js.stripe.com/...">
    // tag (no npm/bundler), so the entry point is StripeConnect.init, not
    // loadConnectAndInitialize (that name only exists on the npm module).
    const stripeConnectInstance = window.StripeConnect.init({
      publishableKey,
      fetchClientSecret,
    });

    const onboarding = stripeConnectInstance.create("account-onboarding");

    // No redirect happens automatically when the connected account finishes
    // (or exits) the embedded flow — send them back to the dashboard so the
    // existing status polling picks up the result.
    onboarding.setOnExit(() => {
      window.location.href = `/?accountId=${accountId}&accountType=standard`;
    });

    loadingEl.classList.add("hidden");
    containerEl.appendChild(onboarding);
  } catch (error) {
    console.error("Error mounting embedded onboarding:", error);
    showError("Couldn't load embedded onboarding — see console for details.");
  }
}

async function initialize() {
  if (!accountId) {
    showError("Missing accountId in the URL — go back to the dashboard and click Start onboarding again.");
    return;
  }

  try {
    const configResponse = await fetch("/api/config", {
      headers: { "X-Stripe-Env": stripeEnv },
    });
    const { publishableKey } = await configResponse.json();

    if (!publishableKey || publishableKey.includes("REPLACE_ME")) {
      showError(
        stripeEnv === "live"
          ? "STRIPE_LIVE_PUBLISHABLE_KEY isn't set in .env — add your pk_live_... key " +
              "from https://dashboard.stripe.com/apikeys and restart the server."
          : "STRIPE_TEST_PUBLISHABLE_KEY isn't set in .env — add your pk_test_... key " +
              "from https://dashboard.stripe.com/test/apikeys and restart the server."
      );
      return;
    }

    // The connect.js <script> tag has no async/defer, so by the time this
    // deferred module runs it should have already finished loading and set
    // window.StripeConnect.init — but fall back to the onLoad hook in case
    // of any load-order edge case.
    window.StripeConnect = window.StripeConnect || {};
    if (window.StripeConnect.init) {
      mountOnboarding(publishableKey);
    } else {
      window.StripeConnect.onLoad = () => mountOnboarding(publishableKey);
    }
  } catch (error) {
    console.error("Error loading embedded onboarding:", error);
    showError("Couldn't load embedded onboarding — see console for details.");
  }
}

document.addEventListener("DOMContentLoaded", initialize);
