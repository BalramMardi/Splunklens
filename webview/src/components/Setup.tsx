import { useState } from "react";

interface Props {
  onSave: () => void;
}

export default function Setup({ onSave }: Props) {
  const [splunkUrl, setSplunkUrl] = useState("https://localhost:8089");
  const [splunkToken, setSplunkToken] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [error, setError] = useState("");

  function handleSave() {
    if (!splunkUrl || !splunkToken || !geminiKey) {
      setError("All three fields are required.");
      return;
    }
    setError("");
    // Send to extension host — credentials stored in SecretStorage there
    // They never live in webview memory after this point

    const normalizedUrl = splunkUrl.replace(/\/+$/, "");

    window.vscodeApi.postMessage({
      type: "SAVE_CREDENTIALS",
      payload: { splunkUrl:normalizedUrl, splunkToken, geminiKey },
    });
    onSave();
  }

  return (
    <div>
      <h2 style={{
        fontSize: "16px",
        fontWeight: 500,
        marginBottom: "4px",
        color: "var(--vscode-foreground)"
      }}>
        SplunkLens Setup
      </h2>
      <p style={{
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        marginBottom: "16px"
      }}>
        Credentials are stored securely in VS Code SecretStorage.
        They never leave the extension host.
      </p>

      <label style={labelStyle}>Splunk URL</label>
      <input
        style={inputStyle}
        value={splunkUrl}
        onChange={e => setSplunkUrl(e.target.value)}
        placeholder="https://localhost:8089"
      />

      <label style={labelStyle}>Splunk Token</label>
      <input
        style={inputStyle}
        type="password"
        value={splunkToken}
        onChange={e => setSplunkToken(e.target.value)}
        placeholder="your-splunk-token"
      />

      <label style={labelStyle}>Gemini API Key</label>
      <input
        style={inputStyle}
        type="password"
        value={geminiKey}
        onChange={e => setGeminiKey(e.target.value)}
        placeholder="your-gemini-api-key"
      />

      {error && (
        <p style={{
          color: "var(--vscode-errorForeground)",
          fontSize: "12px",
          marginBottom: "8px"
        }}>
          {error}
        </p>
      )}

      <button style={buttonStyle} onClick={handleSave}>
        Save and Continue
      </button>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 500,
  marginBottom: "4px",
  color: "var(--vscode-foreground)",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginBottom: "12px",
  padding: "6px 8px",
  fontSize: "13px",
  background: "var(--vscode-input-background)",
  color: "var(--vscode-input-foreground)",
  border: "1px solid var(--vscode-input-border)",
  borderRadius: "4px",
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  marginTop: "8px",
  padding: "7px 16px",
  fontSize: "13px",
  fontWeight: 500,
  background: "var(--vscode-button-background)",
  color: "var(--vscode-button-foreground)",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
};