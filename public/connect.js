// Dashboard page (index.html): manages 3 independent onboarding columns,
// one per Connect account type (express / standard / custom). Each column
// tracks its own connected account, status, and product list.

const ACCOUNT_TYPES = ["express", "standard", "custom"];

// Sandbox/Live environment toggle. Stripe has no API to "switch" an existing
// session between sandbox and live — mode is determined entirely by which
// secret key the server calls the API with. So the toggle just tells the
// server which key to use (via the X-Stripe-Env header on every request) and
// which env's connected accounts to look up. Defaults to sandbox.
const ENV_STORAGE_KEY = "stripeEnv";

// Live mode is temporarily disabled — the toggle is shown but locked to
// Sandbox. Flip this back to true (and remove the `disabled` attribute on
// #env-toggle-input in index.html) to re-enable switching to Live.
const ENV_TOGGLE_ENABLED = false;

function getStripeEnv() {
  if (!ENV_TOGGLE_ENABLED) return "sandbox";
  return localStorage.getItem(ENV_STORAGE_KEY) === "live" ? "live" : "sandbox";
}

// Wraps fetch() to always send the current sandbox/live env, so the server
// picks the matching Stripe client for this request.
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Stripe-Env": getStripeEnv(),
    },
  });
}

function initEnvBanner() {
  const banner = document.querySelector(".env-banner");
  const toggleInput = document.getElementById("env-toggle-input");
  const currentLabel = document.querySelector(".env-banner-current");
  if (!banner || !toggleInput) return;

  function render() {
    const env = getStripeEnv();
    banner.setAttribute("data-env", env);
    toggleInput.checked = env === "live";
    if (currentLabel) {
      currentLabel.textContent = env === "live" ? "Live" : "Sandbox";
    }
  }

  if (ENV_TOGGLE_ENABLED) {
    toggleInput.addEventListener("change", () => {
      localStorage.setItem(ENV_STORAGE_KEY, toggleInput.checked ? "live" : "sandbox");
      // Reload so each column re-reads the accountId scoped to the newly
      // selected env (sandbox and live connected accounts are never the same).
      window.location.reload();
    });
  } else {
    // Toggle is locked to Sandbox — make sure no stale "live" choice from
    // before lingers in storage so getStripeEnv() has nothing to fall back to.
    localStorage.removeItem(ENV_STORAGE_KEY);
    toggleInput.disabled = true;
  }

  render();
}

function initColumn(type) {
  const column = document.querySelector(
    `.onboarding-column[data-account-type="${type}"]`
  );
  if (!column) return;

  // API onboarding (custom) is work-in-progress: the column is greyed out
  // and its buttons carry the `disabled` attribute in index.html already,
  // but skip wiring it up entirely too, so nothing can be triggered from it.
  if (column.classList.contains("onboarding-column-wip")) return;

  // Scoped per onboarding type AND per sandbox/live env, since a connected
  // account created in sandbox doesn't exist in live (and vice versa).
  const storageKey = `accountId_${type}_${getStripeEnv()}`;
  let accountId = localStorage.getItem(storageKey);
  let accountStatus = null;
  let statusInterval;

  // Scoped DOM elements (scoped to this column only, so the 3 columns never
  // interfere with each other's state)
  const createAccountForm = column.querySelector(".create-account-form");
  const emailInput = column.querySelector(".email-input");
  const accountStatusContainer = column.querySelector(".account-status-container");
  const merchantLoginBtn = column.querySelector(".merchant-login-btn");
  const storefrontsEl = column.querySelector(".storefronts");

  function init() {
    if (accountId) {
      fetchAccountStatus();
      updateStorefronts();
    }
    setupEventListeners();
  }

  function setupEventListeners() {
    createAccountForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await createConnectAccount(emailInput.value);
    });

    merchantLoginBtn.addEventListener("click", openDashboardLoginLink);
  }

  async function fetchAccountStatus() {
    if (!accountId) return;

    try {
      const response = await apiFetch(`/api/account-status/${accountId}`);
      if (!response.ok) {
        logout();
        throw new Error("Failed to fetch account status");
      }
      accountStatus = await response.json();
      renderAccountStatus();

      // Show the Login button once the account is onboarded and can accept charges
      if (accountStatus.chargesEnabled) {
        merchantLoginBtn.classList.remove("hidden");
        createAccountForm.classList.add("hidden");
      } else {
        merchantLoginBtn.classList.add("hidden");
      }
    } catch (error) {
      console.error(`[${type}] Error fetching account status:`, error);
    }
  }

  function renderAccountStatus() {
    if (!accountStatus) return;

    const statusColor = accountStatus.chargesEnabled ? "green" : "orange";
    const statusText = accountStatus.chargesEnabled ? "Active" : "Pending";

    accountStatusContainer.innerHTML = `
      <div class="account-status">
        <div class="status-header">
          <h3>Account Status: <span style="color: ${statusColor}">${statusText}</span></h3>
        </div>
        <div class="status-details">
          <div class="status-item">
            <span>Account ID:</span>
            <span>${accountStatus.id}</span>
          </div>
          <div class="status-item">
            <span>Payouts enabled:</span>
            <span>${accountStatus.payoutsEnabled ? "✅" : "❌"}</span>
          </div>
          <div class="status-item">
            <span>Charges enabled:</span>
            <span>${accountStatus.chargesEnabled ? "✅" : "❌"}</span>
          </div>
          <div class="status-item">
            <span>Details submitted:</span>
            <span>${accountStatus.detailsSubmitted ? "✅" : "❌"}</span>
          </div>
        </div>
        <button class="button logout-btn">Log out</button>
        ${needsOnboarding()
          ? `<button class="button margin-bottom-10 start-onboarding">${
              type === "standard" ? "Start onboarding" : "Resolve onboarding"
            }</button>`
          : ""}
      </div>
    `;

    if (needsOnboarding()) {
      accountStatusContainer
        .querySelector(".start-onboarding")
        .addEventListener("click", () => {
          // Embedded onboarding renders inside our own page, on a dedicated
          // route, rather than redirecting to a Stripe-hosted Account Link.
          if (type === "standard") {
            window.location.href = `embedded-onboarding.html?accountId=${accountId}&env=${getStripeEnv()}`;
          } else {
            startOnboarding();
          }
        });
    }

    accountStatusContainer.querySelector(".logout-btn").addEventListener("click", logout);
  }

  function needsOnboarding() {
    return !accountStatus?.chargesEnabled && !accountStatus?.detailsSubmitted;
  }

  function logout() {
    accountId = null;
    accountStatus = null;
    localStorage.removeItem(storageKey);

    // Reset UI
    accountStatusContainer.innerHTML = "";
    merchantLoginBtn.classList.add("hidden");
    createAccountForm.classList.remove("hidden");
    clearInterval(statusInterval);
  }

  function updateStorefronts() {
    storefrontsEl.innerHTML = `
      <a href="store.html?accountId=${accountId}&env=${getStripeEnv()}" class="button storefront-link">
        View Storefront (${accountId})
      </a>
    `;
  }

  // Start polling for account status
  function startStatusPolling() {
    clearInterval(statusInterval);
    statusInterval = setInterval(fetchAccountStatus, 5000);
  }

  async function createConnectAccount(email) {
    try {
      // Stripe-hosted onboarding: create the account and its Account Link in
      // one server round trip, then redirect straight to Stripe's hosted UI.
      if (type === "express") {
        const response = await apiFetch("/api/create-express-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          const { error } = await response.json().catch(() => ({}));
          throw new Error(error || "Failed to create connect account");
        }

        const { accountId: newAccountId, url } = await response.json();
        localStorage.setItem(storageKey, newAccountId);
        window.location.href = url;
        return;
      }

      const response = await apiFetch("/api/create-connect-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, accountType: type }),
      });

      if (!response.ok) {
        const { error } = await response.json().catch(() => ({}));
        throw new Error(error || "Failed to create connect account");
      }

      const { accountId: newAccountId } = await response.json();
      accountId = newAccountId;
      localStorage.setItem(storageKey, accountId);
      await fetchAccountStatus();
      updateStorefronts();
      startStatusPolling();
    } catch (error) {
      console.error(`[${type}] Error creating connect account`, error);
      alert(`Couldn't create the connected account: ${error.message}`);
    }
  }

  async function openDashboardLoginLink() {
    if (!accountId) return;

    try {
      const response = await apiFetch(`/api/login-link/${accountId}`);
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({}));
        throw new Error(error || "Failed to create login link");
      }

      const { url } = await response.json();
      // Single-use, short-lived link — redirect immediately.
      window.location.href = url;
    } catch (error) {
      console.error(`[${type}] Error creating dashboard login link:`, error);
      alert(
        "Couldn't create a dashboard login link for this account. " +
          "This only works for accounts using the Express Dashboard (see console for details)."
      );
    }
  }

  async function startOnboarding() {
    try {
      const response = await apiFetch("/api/create-account-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });

      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      console.error(`[${type}] Error starting onboarding:`, error);
    }
  }

  init();
  if (accountId) {
    startStatusPolling();
  }

  window.addEventListener("beforeunload", () => clearInterval(statusInterval));
}

document.addEventListener("DOMContentLoaded", () => {
  initEnvBanner();
  ACCOUNT_TYPES.forEach(initColumn);
});
