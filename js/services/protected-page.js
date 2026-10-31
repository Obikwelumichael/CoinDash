import { getCurrentUser } from "./auth-store.js";

let redirecting = false;

export async function verifyProtectedPageSession() {
  if (redirecting) return false;
  const user = await getCurrentUser();
  if (user) return true;
  redirecting = true;
  window.location.replace("/login");
  return false;
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) void verifyProtectedPageSession();
});

void verifyProtectedPageSession();
