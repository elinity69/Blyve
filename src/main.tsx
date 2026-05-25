
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
  import "./lib/i18n"; // Initialize i18n before App renders
  import { applyBootTheme } from "./app/lib/theme";

  applyBootTheme();

  createRoot(document.getElementById("root")!).render(<App />);
  // Service worker only in production — avoids stale cache + chrome-extension errors in dev
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    });
  }
  
