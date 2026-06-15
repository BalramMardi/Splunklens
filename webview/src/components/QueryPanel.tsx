import { useEffect, useState } from "react";
import { type QueryResult } from "../types.ts";

interface Props {
  onLogout: () => void;
}

export default function QueryPanel({ onLogout }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [showSPL, setShowSPL] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "QUERY_RESULTS") {
        setResult(msg.payload);
        setLoading(false);
      }
      if (msg.type === "QUERY_ERROR") {
        setError(msg.payload.message);
        setLoading(false);
      }
      if (msg.type === "QUERY_STATUS") {
        setStatusMessage(msg.payload.message);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  function handleLogout() {
    window.vscodeApi.postMessage({ type: "CLEAR_CREDENTIALS" });
    onLogout();
  }

  function handleQuery(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setShowSPL(false);
    setHistory(prev => [q, ...prev.filter(h => h !== q).slice(0, 4)]);

    window.vscodeApi.postMessage({
      type: "SUBMIT_QUERY",
      payload: { query: q, model: selectedModel },
    });
  }

  function handleCancel() {
    window.vscodeApi.postMessage({ type: "CANCEL_QUERY" });
  }

  function handleOpenInSplunk() {
    if (!result) return;
    window.vscodeApi.postMessage({
      type: "OPEN_IN_SPLUNK",
      payload: { query: result.query }
    });
  }

  function handleExportCSV() {
    if (!result || !result.events.length) return;
    window.vscodeApi.postMessage({
      type: "EXPORT_CSV",
      payload: { events: result.events }
    });
  }

  function toggleSPL() {
    setShowSPL(!showSPL);
  }

  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "8px"
      }}>
        <h2 style={{
          fontSize: "15px",
          fontWeight: 500,
          color: "var(--vscode-foreground)",
          margin: 0
        }}>
          SplunkLens
        </h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={loading}
            style={{
              fontSize: "11px",
              background: "var(--vscode-dropdown-background)",
              color: "var(--vscode-dropdown-foreground)",
              border: "1px solid var(--vscode-dropdown-border)",
              borderRadius: "4px",
              padding: "2px 4px",
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
            <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
          </select>
          <button
            onClick={handleLogout}
            style={{
              fontSize: "11px",
              background: "transparent",
              color: "var(--vscode-descriptionForeground)",
              border: "1px solid var(--vscode-input-border)",
              borderRadius: "4px",
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
        <input
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: "13px",
            background: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            border: "1px solid var(--vscode-input-border)",
            borderRadius: "4px",
          }}
          placeholder="Show failed logins in the last 1 hour..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleQuery(query)}
          disabled={loading}
        />
        
        {loading ? (
          <button
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              background: "var(--vscode-errorForeground)",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            onClick={handleCancel}
          >
            Stop
          </button>
        ) : (
          <button
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              background: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            onClick={() => handleQuery(query)}
          >
            Search
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px",
          marginBottom: "10px"
        }}>
          {history.map((h, i) => (
            <span
              key={i}
              onClick={() => { setQuery(h); handleQuery(h); }}
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "10px",
                background: "var(--vscode-badge-background)",
                color: "var(--vscode-badge-foreground)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                maxWidth: "160px",
                textOverflow: "ellipsis",
              }}
            >
              {h}
            </span>
          ))}
        </div>
      )}

      {loading && (
        <p style={{
          fontSize: "12px",
          color: "var(--vscode-descriptionForeground)",
          marginBottom: "8px"
        }}>
          {statusMessage || "Searching..."}
        </p>
      )}

      {error && (
        <p style={{
          fontSize: "12px",
          color: "var(--vscode-errorForeground)",
          marginBottom: "8px"
        }}>
          {error}
        </p>
      )}

      {result && (
        <div>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "6px"
          }}>
            <span style={{
              fontSize: "12px",
              color: "var(--vscode-descriptionForeground)"
            }}>
              {result.resultCount} events — {result.timeRange}
            </span>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleExportCSV}
                style={{
                  fontSize: "11px",
                  background: "transparent",
                  color: "var(--vscode-textLink-foreground)",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Export CSV
              </button>
              <button
                onClick={handleOpenInSplunk}
                style={{
                  fontSize: "11px",
                  background: "transparent",
                  color: "var(--vscode-textLink-foreground)",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Open in Splunk
              </button>
              <button
                onClick={toggleSPL}
                style={{
                  fontSize: "11px",
                  background: "transparent",
                  color: "var(--vscode-textLink-foreground)",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {showSPL ? "Hide SPL" : "Show SPL"}
              </button>
            </div>
          </div>

          {showSPL && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{
                background: "var(--vscode-textCodeBlock-background)",
                padding: "8px",
                borderRadius: "4px",
              }}>
                <pre style={{
                  fontSize: "11px",
                  color: "var(--vscode-foreground)",
                  overflowX: "auto",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}>
                  {result.query}
                </pre>
              </div>
            </div>
          )}

          <div style={{ fontSize: "12px" }}>
            {result.events.map((event, i) => (
              <div key={i} style={{
                borderBottom: "1px solid var(--vscode-panel-border)",
                padding: "6px 0",
              }}>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    cursor: "pointer",
                    alignItems: "flex-start"
                  }}
                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                >
                  <span style={{
                    color: getSeverityColor(event.severity),
                    minWidth: "52px",
                    fontWeight: 500,
                  }}>
                    {event.severity?.toUpperCase() ?? "INFO"}
                  </span>
                  <span style={{
                    color: "var(--vscode-descriptionForeground)",
                    minWidth: "120px",
                  }}>
                    {formatTime(event._time)}

                  </span>
                  <span style={{ color: "var(--vscode-foreground)" }}>
                    {event.message ?? event.event_type ?? "event"}
                  </span>
                </div>

                {expandedRow === i && (
                  <pre style={{
                    marginTop: "6px",
                    fontSize: "11px",
                    background: "var(--vscode-textCodeBlock-background)",
                    padding: "8px",
                    borderRadius: "4px",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                  }}>
                    {JSON.stringify(event, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getSeverityColor(severity?: string): string {
  switch (severity?.toLowerCase()) {
    case "critical": return "var(--vscode-testing-iconFailed)";
    case "high":     return "var(--vscode-errorForeground)";
    case "medium":   return "var(--vscode-testing-iconQueued)";
    case "low":      return "var(--vscode-testing-iconPassed)";
    default:         return "var(--vscode-foreground)";
  }
}

function formatTime(t?: string): string {
  if (!t) return "";

  const isoFormatted = t.replace(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, "$1T$2");
  
  const strippedTime = isoFormatted.replace(/\s+[A-Za-z\s]+$/, "");

  const d = new Date(strippedTime);

  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const time = d.toLocaleTimeString();
    
    return `${day}/${month}/${year} ${time}`;
  }

  const dateMatch = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = t.match(/\b(\d{2}:\d{2}:\d{2})\b/);
  
  if (dateMatch && timeMatch) {
    return `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]} ${timeMatch[1]}`;
  } else if (timeMatch) {
    return timeMatch[1]; 
  }

  return t;
}