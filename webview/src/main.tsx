import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./vscode-mock.css";

declare const acquireVsCodeApi: () => Window["vscodeApi"];

// Mock vscodeApi when running in browser for development
if (typeof acquireVsCodeApi !== "undefined") {
  window.vscodeApi = acquireVsCodeApi();
} else {
  window.vscodeApi = {
    postMessage: (msg: unknown) => console.log("vscode message:", msg),
    getState: () => ({}),
    setState: () => {},
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);