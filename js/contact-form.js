/**
 * js/contact-form.js
 *
 * Powers the "Contact Us" section shared by the About and FAQ pages.
 * - Injects a modal enquiry form the first time a trigger button is clicked.
 * - Validates required fields + email format client-side (server also
 *   validates independently — client-side checks are for UX, not security).
 * - On submit, sends the enquiry to the Supabase Edge Function AND to
 *   Formspree AT THE SAME TIME (both requests start together, neither
 *   waits for the other to finish first).
 * - Shows a success message once both attempts have settled, as long as
 *   the Supabase save (the primary record) succeeded. Formspree is a
 *   backup channel; if only Formspree fails, we still show success but
 *   log it, since the enquiry is safely stored either way.
 *
 * Usage: add a button with class="contact-us-trigger" to a page, and
 * include this script. Works identically on any page it's included on.
 */

const EDGE_FUNCTION_URL = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1/submit-enquiry";
const FORMSPREE_URL = "https://formspree.io/f/xdkdvygq";

const AUDIENCE_OPTIONS = [
  { value: "high_school_learner", label: "High school learner" },
  { value: "gap_year", label: "Gap year" },
  { value: "uni_or_college_student", label: "Uni or college student" },
  { value: "general_person", label: "General person" },
  { value: "other", label: "Other" },
];

let modalEl = null;

function buildModal() {
  if (modalEl) return modalEl;

  const overlay = document.createElement("div");
  overlay.className = "contact-modal-overlay";
  overlay.setAttribute("role", "presentation");

  overlay.innerHTML = `
    <div class="contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
      <button type="button" class="contact-modal-close" aria-label="Close">&times;</button>
      <h2 id="contact-modal-title">Contact Us</h2>
      <p class="contact-modal-subtitle">If you have any queries or require any help, get in touch with us.</p>

      <form class="contact-form" novalidate>
        <div class="cf-field">
          <label for="cf-full-name">Full Name <span aria-hidden="true">*</span></label>
          <input type="text" id="cf-full-name" name="full_name" required autocomplete="name">
          <span class="cf-error" data-error-for="full_name"></span>
        </div>

        <div class="cf-field">
          <label for="cf-email">Email Address <span aria-hidden="true">*</span></label>
          <input type="email" id="cf-email" name="email" required autocomplete="email">
          <span class="cf-error" data-error-for="email"></span>
        </div>

        <div class="cf-field">
          <label for="cf-phone">Phone Number <span aria-hidden="true">*</span></label>
          <input type="tel" id="cf-phone" name="phone" required autocomplete="tel">
          <span class="cf-error" data-error-for="phone"></span>
        </div>

        <div class="cf-field">
          <label for="cf-enquiry">Enquiry <span aria-hidden="true">*</span></label>
          <textarea id="cf-enquiry" name="enquiry" rows="4" required></textarea>
          <span class="cf-error" data-error-for="enquiry"></span>
        </div>

        <fieldset class="cf-field cf-fieldset">
          <legend>Do you have a QueryCrest account? <span aria-hidden="true">*</span></legend>
          <label class="cf-radio"><input type="radio" name="has_account" value="yes" required> Yes</label>
          <label class="cf-radio"><input type="radio" name="has_account" value="no"> No</label>
          <span class="cf-error" data-error-for="has_account"></span>
        </fieldset>

        <fieldset class="cf-field cf-fieldset">
          <legend>Which of these best describes you? <span aria-hidden="true">*</span></legend>
          ${AUDIENCE_OPTIONS.map((opt, i) => `
            <label class="cf-radio">
              <input type="radio" name="audience" value="${opt.value}" ${i === 0 ? "required" : ""}>
              ${opt.label}
            </label>
          `).join("")}
          <span class="cf-error" data-error-for="audience"></span>
        </fieldset>

        <div class="cf-status" role="status" aria-live="polite"></div>

        <button type="submit" class="cf-submit">Send Enquiry</button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  modalEl = overlay;

  overlay.querySelector(".contact-modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  overlay.querySelector(".contact-form").addEventListener("submit", handleSubmit);

  return overlay;
}

function openModal() {
  const overlay = buildModal();
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  overlay.querySelector("#cf-full-name").focus();
}

function closeModal() {
  if (!modalEl) return;
  modalEl.classList.remove("open");
  document.body.style.overflow = "";
}

function clearErrors(form) {
  form.querySelectorAll(".cf-error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".cf-field, .cf-fieldset").forEach((el) => el.classList.remove("cf-invalid"));
}

function setFieldError(form, field, message) {
  const errEl = form.querySelector(`[data-error-for="${field}"]`);
  if (errEl) errEl.textContent = message;
  const container = errEl?.closest(".cf-field") || errEl?.closest(".cf-fieldset");
  if (container) container.classList.add("cf-invalid");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form, data) {
  clearErrors(form);
  let valid = true;

  if (!data.full_name.trim()) {
    setFieldError(form, "full_name", "Please enter your full name.");
    valid = false;
  }
  if (!data.email.trim() || !EMAIL_RE.test(data.email.trim())) {
    setFieldError(form, "email", "Please enter a valid email address.");
    valid = false;
  }
  if (!data.phone.trim()) {
    setFieldError(form, "phone", "Please enter your phone number.");
    valid = false;
  }
  if (!data.enquiry.trim()) {
    setFieldError(form, "enquiry", "Please enter your enquiry.");
    valid = false;
  }
  if (data.has_account !== "yes" && data.has_account !== "no") {
    setFieldError(form, "has_account", "Please select an option.");
    valid = false;
  }
  if (!data.audience) {
    setFieldError(form, "audience", "Please select an option.");
    valid = false;
  }

  return valid;
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const statusEl = form.querySelector(".cf-status");
  const submitBtn = form.querySelector(".cf-submit");

  const formData = new FormData(form);
  const data = {
    full_name: (formData.get("full_name") || "").toString(),
    email: (formData.get("email") || "").toString(),
    phone: (formData.get("phone") || "").toString(),
    enquiry: (formData.get("enquiry") || "").toString(),
    has_account: (formData.get("has_account") || "").toString(),
    audience: (formData.get("audience") || "").toString(),
  };

  if (!validate(form, data)) {
    statusEl.textContent = "";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";
  statusEl.textContent = "";
  statusEl.className = "cf-status";

  const payload = {
    full_name: data.full_name.trim(),
    email: data.email.trim(),
    phone: data.phone.trim(),
    enquiry: data.enquiry.trim(),
    has_account: data.has_account === "yes",
    audience: data.audience,
    source_page: (location.pathname.split("/").pop() || "").replace(".html", "") || "unknown",
  };

  // Fire both submissions in parallel — neither waits for the other to
  // start or finish. Supabase is the primary, durable record; Formspree
  // is the backup inbox while this feature is new.
  const supabasePromise = fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const formspreePromise = fetch(FORMSPREE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });

  const [supabaseResult, formspreeResult] = await Promise.allSettled([
    supabasePromise,
    formspreePromise,
  ]);

  const supabaseOk = supabaseResult.status === "fulfilled" && supabaseResult.value.ok;
  const formspreeOk = formspreeResult.status === "fulfilled" && formspreeResult.value.ok;

  if (!formspreeOk) {
    console.error("Contact form: Formspree backup submission failed", formspreeResult);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Send Enquiry";

  if (supabaseOk) {
    form.reset();
    statusEl.className = "cf-status cf-success";
    statusEl.textContent = "Thanks — we've received your enquiry and will reply within 24 hours.";
  } else {
    console.error("Contact form: Supabase submission failed", supabaseResult);
    statusEl.className = "cf-status cf-error";
    statusEl.textContent = "Something went wrong sending your enquiry. Please try again, or email us directly at support@querycrest.com.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".contact-us-trigger").forEach((btn) => {
    btn.addEventListener("click", openModal);
  });
});
