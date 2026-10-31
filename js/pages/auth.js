import { completeTwoFactorLogin, getCurrentUser, loginUser, registerUser } from "../services/auth-store.js";
import { protectPasswordFieldCopy } from "../ui/password-fields.js";

protectPasswordFieldCopy();

const form = document.querySelector("[data-auth-form]");
const feedback = document.getElementById("authFeedback");
const submit = form?.querySelector('button[type="submit"]');
const isRegister = form?.dataset.authForm === "register";
let twoFactorChallenge = "";

getCurrentUser();

if (!isRegister && new URLSearchParams(window.location.search).get("reset") === "success") {
  showFeedback("Your password was reset successfully. Sign in with your new password.", "success");
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("reset");
  window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

function showFeedback(message, type = "") {
  feedback.textContent = message;
  feedback.className = `auth-feedback${type ? ` is-${type}` : ""}`;
}

function markServerFieldError(fields) {
  if (!fields || typeof fields !== "object") return "";
  const [name, message] = Object.entries(fields)[0] || [];
  const input = name ? form.elements[name] : null;
  if (input instanceof HTMLElement) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
  return typeof message === "string" ? message : "";
}

function validateForm() {
  const values = Object.fromEntries(new FormData(form));
  const controls = [...form.querySelectorAll("input")];
  controls.forEach((input) => {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
  });

  let invalidInput;
  if (isRegister && values.displayName.trim().length < 2) {
    invalidInput = form.elements.displayName;
    invalidInput.setCustomValidity("Display name must contain at least 2 characters.");
  } else if (!form.elements.email.validity.valid || !values.email.trim()) {
    invalidInput = form.elements.email;
    invalidInput.setCustomValidity("Enter a valid email address.");
  } else if (twoFactorChallenge) {
    if (!/^\d{6}$/.test(values.code || "") && !/^[a-f\d]{4}(?:-[a-f\d]{4}){7}$/i.test(values.code || "")) {
      invalidInput = form.elements.code;
      invalidInput.setCustomValidity("Enter a six-digit code or a recovery code.");
    }
  } else if (!values.password) {
    invalidInput = form.elements.password;
    invalidInput.setCustomValidity("Enter your password.");
  } else if (isRegister && values.password.length < 12) {
    invalidInput = form.elements.password;
    invalidInput.setCustomValidity("Use at least 12 characters for your password.");
  } else if (isRegister && values.password !== values.confirmPassword) {
    invalidInput = form.elements.confirmPassword;
    invalidInput.setCustomValidity("Passwords do not match.");
  }

  if (invalidInput) {
    invalidInput.setAttribute("aria-invalid", "true");
    invalidInput.reportValidity();
    showFeedback(invalidInput.validationMessage, "error");
    return null;
  }
  return values;
}

function updatePasswordGuidance() {
  const password = form?.elements.password;
  const guidance = document.getElementById("passwordGuidance");
  if (!password || !guidance) return;
  const length = password.value.length;
  const variety = [/[a-z]/.test(password.value), /[A-Z]/.test(password.value), /\d/.test(password.value), /[^a-zA-Z0-9]/.test(password.value)].filter(Boolean).length;
  guidance.textContent = length === 0
    ? "Use at least 12 characters. A longer passphrase is easier to remember and harder to guess."
    : length < 12
      ? `${12 - length} more character${12 - length === 1 ? "" : "s"} needed (12 minimum).`
      : variety < 2
        ? "Length requirement met. Add a mix of letter cases, numbers, or symbols for a stronger passphrase."
        : "Good start. Use a unique passphrase you do not use elsewhere. The server checks the final password.";
  guidance.classList.toggle("is-ready", length >= 12 && variety >= 2);
}

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "Show" : "Hide";
    button.setAttribute("aria-label", `${visible ? "Show" : "Hide"} ${input.name === "confirmPassword" ? "confirmed password" : "password"}`);
    button.setAttribute("aria-pressed", String(!visible));
    input.focus();
  });
});

form?.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
  input.removeAttribute("aria-invalid");
  input.setCustomValidity("");
}));

form?.elements.password?.addEventListener("input", updatePasswordGuidance);
form?.elements.confirmPassword?.addEventListener("input", () => {
  form.elements.confirmPassword.setCustomValidity(
    form.elements.password.value === form.elements.confirmPassword.value ? "" : "Passwords do not match.",
  );
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  showFeedback("");
  const values = validateForm();
  if (!values) return;

  submit.disabled = true;
  form.setAttribute("aria-busy", "true");
  submit.textContent = isRegister ? "Creating account…" : "Signing in…";
  showFeedback(isRegister ? "Creating your secure account…" : "Signing you in…");
  try {
    if (!isRegister && twoFactorChallenge) {
      const user = await completeTwoFactorLogin(twoFactorChallenge, values.code.trim());
      showFeedback(`Welcome, ${user.display_name}. Opening CoinDash…`, "success");
      window.location.assign("/markets");
      return;
    }
    const user = isRegister
      ? await registerUser({ email: values.email.trim(), password: values.password, displayName: values.displayName.trim() })
      : await loginUser({ email: values.email.trim(), password: values.password });
    if (user.twoFactorRequired) {
      twoFactorChallenge = user.challenge;
      form.elements.password.value = "";
      form.querySelectorAll(".auth-field").forEach((field) => { field.hidden = true; });
      const codeField = document.createElement("div");
      codeField.className = "auth-field auth-two-factor-field";
      const codeLabel = document.createElement("label");
      codeLabel.htmlFor = "loginTwoFactorCode";
      codeLabel.textContent = "Authenticator or recovery code";
      const codeInput = document.createElement("input");
      codeInput.id = "loginTwoFactorCode";
      codeInput.name = "code";
      codeInput.type = "text";
      codeInput.autocomplete = "one-time-code";
      codeInput.inputMode = "text";
      codeInput.autocapitalize = "characters";
      codeInput.maxLength = 39;
      codeInput.setAttribute("aria-describedby", "authFeedback");
      codeInput.required = true;
      codeField.append(codeLabel, codeInput);
      form.insertBefore(codeField, feedback);
      submit.textContent = "Verify and sign in";
      showFeedback("Enter the code from your authenticator app, or use one recovery code.");
      codeInput.focus();
      return;
    }
    showFeedback(`Welcome, ${user.display_name}. Opening CoinDash…`, "success");
    window.location.assign("/markets");
  } catch (error) {
    const fieldMessage = markServerFieldError(error.fields);
    showFeedback(fieldMessage || error.message || "Unable to authenticate right now. Please try again.", "error");
  } finally {
    submit.disabled = false;
    form.removeAttribute("aria-busy");
    submit.textContent = isRegister ? "Create account" : (twoFactorChallenge ? "Verify and sign in" : "Sign in");
  }
});

updatePasswordGuidance();
