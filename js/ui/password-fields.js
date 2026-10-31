export function protectPasswordFieldCopy(root = document) {
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.copyProtectionBound === "true") return;
    input.dataset.copyProtectionBound = "true";
    input.addEventListener("copy", (event) => event.preventDefault());
    input.addEventListener("cut", (event) => event.preventDefault());
  });
}
