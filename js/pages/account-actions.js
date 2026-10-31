import { protectPasswordFieldCopy } from "../ui/password-fields.js";

protectPasswordFieldCopy();

const action = document.querySelector("[data-account-action]");
const feedback = document.querySelector("[data-feedback]");
const form = action?.matches("form") ? action : null;
const submit = form?.querySelector('button[type="submit"]');

function show(message, type = "") {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `auth-feedback${type ? ` is-${type}` : ""}`;
  if (action?.dataset.accountAction === "verify" && type) action.dataset.state = type;
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Unable to reach CoinDash. Check your connection and try again.");
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "This request could not be completed. Please try again.");
  if (typeof data.message !== "string") throw new Error("CoinDash returned an unexpected response.");
  return data;
}

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "Show" : "Hide";
    button.setAttribute("aria-label", `${visible ? "Show" : "Hide"} password`);
    button.setAttribute("aria-pressed", String(!visible));
    input.focus();
  });
});

form?.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
  input.removeAttribute("aria-invalid");
  input.setCustomValidity("");
}));

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const values = Object.fromEntries(new FormData(form));
  const email = form.elements.email;
  if (email && !email.validity.valid) {
    email.setAttribute("aria-invalid", "true");
    email.reportValidity();
    show("Enter a valid email address.", "error");
    return;
  }
  if (form.dataset.accountAction === "reset") {
    const password = values.password;
    const confirm = form.elements.confirmPassword;
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      form.elements.password.setAttribute("aria-invalid", "true");
      show("Password must be 12–128 characters.", "error");
      return;
    }
    if (password !== values.confirmPassword) {
      confirm.setAttribute("aria-invalid", "true");
      show("Passwords do not match.", "error");
      return;
    }
  }

  submit.disabled = true;
  form.setAttribute("aria-busy", "true");
  submit.textContent = form.dataset.accountAction === "forgot" ? "Sending…" : "Updating…";
  show(form.dataset.accountAction === "forgot" ? "Submitting request…" : "Updating your password…");
  let redirectingToLogin = false;
  try {
    if (form.dataset.accountAction === "forgot") {
      const result = await post("/api/auth/forgot-password", { email: values.email.trim() });
      show(result.message, "success");
      form.reset();
    } else {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) throw new Error("This reset link is invalid or expired. Request a new one.");
      const result = await post("/api/auth/reset-password", { token, password: values.password });
      show(`${result.message} Redirecting you to sign in…`, "success");
      form.reset();
      redirectingToLogin = true;
      submit.textContent = "Redirecting…";
      window.setTimeout(() => {
        window.location.replace("/login?reset=success");
      }, 1200);
    }
  } catch (error) {
    show(error.message || "Unable to complete this request right now.", "error");
  } finally {
    if (redirectingToLogin) return;
    submit.disabled = false;
    form.removeAttribute("aria-busy");
    submit.textContent = form.dataset.accountAction === "forgot" ? "Send reset link" : "Update password";
  }
});

if (action?.dataset.accountAction === "verify") {
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) {
    show("This verification link is invalid or expired. Sign in and request a new one.", "error");
    action.setAttribute("aria-busy", "false");
  } else {
    post("/api/auth/verification/confirm", { token })
      .then((result) => show(result.message, "success"))
      .catch((error) => show(error.message || "Unable to verify this email.", "error"))
      .finally(() => action.setAttribute("aria-busy", "false"));
  }
}

if (form?.dataset.accountAction === "reset" && !new URLSearchParams(window.location.search).get("token")) {
  show("This reset link is invalid or expired. Request a new one.", "error");
  submit.disabled = true;
}
