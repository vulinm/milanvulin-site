import { useState } from "react";

type Theme = "dark" | "light";

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

// Dark by default; the choice is remembered in this browser only.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(current);

  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* storage blocked: the choice lasts until the page is closed */
    }
    setTheme(next);
  };

  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
