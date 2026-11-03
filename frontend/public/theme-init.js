// Runs before the page is painted (a same-origin script, since the CSP blocks inline ones).
// Dark is the default; only an explicit choice made with the toggle switches to light.
try {
  if (localStorage.getItem("theme") === "light") document.documentElement.dataset.theme = "light";
} catch {
  /* storage blocked: stay on dark */
}
