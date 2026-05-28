import { useState, useEffect } from "react";
import Setup from "./components/Setup";
import QueryPanel from "./components/QueryPanel";

type AppState = "checking" | "setup" | "ready";

export default function App() {
  const [appState, setAppState] = useState<AppState>("checking");

  useEffect(() => {
    // Ask extension host if credentials exist
    window.vscodeApi.postMessage({ type: "CHECK_CREDENTIALS" });

    // Fallback timeout — if no response in 500ms
    // we are in browser dev mode, go straight to setup
    const timeout = setTimeout(() => {
      setAppState("setup");
    }, 500);

    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "CREDENTIALS_EXIST") {
        clearTimeout(timeout);
        setAppState("ready");
      }
      if (msg.type === "CREDENTIALS_MISSING") {
        clearTimeout(timeout);
        setAppState("setup");
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      clearTimeout(timeout);
    };
  }, []);

  if (appState === "checking") {
    return (
      <main style={{ padding: "12px" }}>
        <p style={{
          fontSize: "12px",
          color: "var(--vscode-descriptionForeground)"
        }}>
          Loading...
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: "12px" }}>
      {appState === "setup" ? (
        <Setup onSave={() => setAppState("ready")} />
      ) : (
        <QueryPanel onLogout={() => setAppState("setup")} />
      )}
    </main>
  );
}