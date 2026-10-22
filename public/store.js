// Fake storefront (store.html): shown after Stripe-hosted (Express)
// onboarding completes. Lets you pay for a fixed T-Shirt product; the charge
// goes directly to whichever connected account is in the input below (see
// /api/create-store-checkout-session). Pre-filled from the accountId URL
// param (set after onboarding), but left editable so payments can be
// pointed at any connected account for testing.

const urlParams = new URLSearchParams(window.location.search);
const accountId = urlParams.get("accountId");
// Sandbox/Live env carried over from the dashboard's toggle (see connect.js).
// Kept in sync with server.js's T_SHIRT_PRICE map: 10.99 EUR in sandbox,
// 1 EUR in live.
const stripeEnv = urlParams.get("env") === "live" ? "live" : "sandbox";
const T_SHIRT_PRICE_LABEL = {
  sandbox: "10.99 €",
  live: "1.00 €",
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("account-id-input").value = accountId || "";
  document.getElementById("env-input").value = stripeEnv;
  document.getElementById("product-price").textContent = T_SHIRT_PRICE_LABEL[stripeEnv];
});
