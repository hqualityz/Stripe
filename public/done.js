// Confirmation page (done.html): reads session_id + accountId from the
// success_url, then fetches the payment/fee breakdown from the server
// (session, charge, and balance transaction all live on the connected
// account since checkouts are direct charges — see /api/checkout-session).

function formatAmount(amountInSmallestUnit, currency) {
  if (amountInSmallestUnit == null || !currency) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountInSmallestUnit / 100);
}

async function initialize() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session_id");
  const accountId = urlParams.get("accountId");

  document.getElementById("dashboard").href = accountId
    ? `https://dashboard.stripe.com/${accountId}`
    : "https://dashboard.stripe.com";
  document.getElementById("account-id").textContent = accountId || "unknown";

  if (!sessionId || !accountId) return;

  try {
    const response = await fetch(
      `/api/checkout-session/${sessionId}?accountId=${accountId}`
    );
    if (!response.ok) throw new Error("Failed to fetch payment details");

    const details = await response.json();

    document.getElementById("amount-total").textContent = formatAmount(
      details.amountTotal,
      details.currency
    );
    document.getElementById("payment-status").textContent =
      details.paymentStatus || "—";
    document.getElementById("payment-method").textContent = details.cardBrand
      ? `${details.cardBrand} •••• ${details.cardLast4}`
      : (details.paymentMethodTypes || []).join(", ") || "—";
    document.getElementById("stripe-fee").textContent = formatAmount(
      details.stripeFee,
      details.feeCurrency
    );
    document.getElementById("net-amount").textContent = formatAmount(
      details.netAmount,
      details.feeCurrency
    );
  } catch (error) {
    console.error("Error fetching payment details:", error);
  }
}

document.addEventListener("DOMContentLoaded", initialize);
