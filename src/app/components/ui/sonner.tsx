import { Toaster as Sonner } from "sonner";
import { useEffect, useState } from "react";

export function Toaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Check if dark mode is active
    const checkTheme = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "dark" : "light");
    };

    // Check on mount
    checkTheme();

    // Watch for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        className: "font-sans",
        style: {
          background: theme === "dark" ? "#1e293b" : "#ffffff",
          color: theme === "dark" ? "#f1f5f9" : "#0f172a",
          border: `1px solid ${theme === "dark" ? "#334155" : "#e2e8f0"}`,
        },
      }}
    />
  );
}
