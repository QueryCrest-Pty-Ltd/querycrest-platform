/**
 * js/terms-of-service.js
 *
 * Fetches Terms of Service content from the terms-of-service Edge Function
 * and renders it into #terms-of-service-content on termsOfService.html.
 *
 * The page must never fall back to hardcoded ToS text in the HTML — that
 * would defeat the point of making content admin-editable in the database.
 */

const EDGE_FUNCTION_URL = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1/terms-of-service";
// Supabase's anon/public key. This is NOT a secret — it's designed to be
// used in frontend JavaScript. It only grants access allowed by your
// Row Level Security policies, unlike the service-role key.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhranN5ZGVhdmRjYXJ3a3RocHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NTQwMDMsImV4cCI6MjA3NzIzMDAwM30.elwK1K_mBfNGFrmzeJ3-Os1Zy_hrDJ1PPI0guFTGUrk";
const CONTAINER_ID = "terms-of-service-content";

async function loadTermsOfService() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    console.error(`Terms of Service: #${CONTAINER_ID} not found on page`);
    return;
  }

  showLoading(container);

  let response;
  try {
    response = await fetch(EDGE_FUNCTION_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
  } catch (networkError) {
    console.error("Terms of Service: network error", networkError);
    showError(container, "We couldn't reach our servers. Please check your connection and try again.");
    return;
  }

  if (!response.ok) {
    console.error(`Terms of Service: request failed with status ${response.status}`);
    showError(container, "We're unable to load the Terms of Service right now. Please try again shortly.");
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error("Terms of Service: invalid JSON response", parseError);
    showError(container, "We received an unexpected response. Please try again shortly.");
    return;
  }

  if (!data || typeof data.content !== "string" || data.content.trim() === "") {
    console.error("Terms of Service: empty or invalid payload", data);
    showError(container, "Terms of Service content is currently unavailable.");
    return;
  }

  renderContent(container, data.content);
}

function showLoading(container) {
  container.innerHTML = `<p class="tos-loading" role="status">Loading Terms of Service…</p>`;
}

function showError(container, message) {
  container.innerHTML = `<p class="tos-error" role="alert">${escapeHtml(message)}</p>`;
}

function renderContent(container, htmlContent) {
  if (typeof DOMPurify === "undefined") {
    console.error("Terms of Service: DOMPurify not loaded, refusing to render raw HTML");
    showError(container, "Unable to display content securely. Please try again later.");
    return;
  }

  const clean = DOMPurify.sanitize(htmlContent, {
    ALLOWED_TAGS: ["p", "h3", "h4", "ul", "ol", "li", "strong", "em", "a", "br", "q", "b", "span"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });

  container.innerHTML = clean;

  container.querySelectorAll("a[href]").forEach((link) => {
    link.setAttribute("rel", "noopener noreferrer");
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", loadTermsOfService);