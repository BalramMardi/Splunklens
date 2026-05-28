import { useEffect, useState } from "react";
import {type QueryResult } from "../types.ts";

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

  // Correctly register message listener with useEffect
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
    };
    window.addEventListener("message", handler);
    // Cleanup — removes listener when component unmounts
    return () => window.removeEventListener("message", handler);
  }, []); // empty array = runs once on mount only

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

    // Send query text to extension host — no credentials, no API calls here
    window.vscodeApi.postMessage({
      type: "SUBMIT_QUERY",
      payload: { query: q },
    });
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

      {/* Query input */}
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
        <button
          style={{
            padding: "6px 14px",
            fontSize: "13px",
            background: "var(--vscode-button-background)",
            color: "var(--vscode-button-foreground)",
            border: "none",
            borderRadius: "4px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
          onClick={() => handleQuery(query)}
          disabled={loading}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Query history chips */}
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

      {/* Loading */}
      {loading && (
        <p style={{
          fontSize: "12px",
          color: "var(--vscode-descriptionForeground)",
          marginBottom: "8px"
        }}>
          Translating query and searching Splunk...
        </p>
      )}

      {/* Error */}
      {error && (
        <p style={{
          fontSize: "12px",
          color: "var(--vscode-errorForeground)",
          marginBottom: "8px"
        }}>
          {error}
        </p>
      )}

      {/* Results */}
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
            <button
              onClick={() => setShowSPL(s => !s)}
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

          <p style={{
            fontSize: "12px",
            color: "var(--vscode-descriptionForeground)",
            marginBottom: "8px",
            fontStyle: "italic"
          }}>
            {result.explanation}
          </p>

          {showSPL && (
            <pre style={{
              fontSize: "11px",
              background: "var(--vscode-textCodeBlock-background)",
              color: "var(--vscode-foreground)",
              padding: "8px",
              borderRadius: "4px",
              overflowX: "auto",
              marginBottom: "10px",
              whiteSpace: "pre-wrap",
            }}>
              {result.query}
            </pre>
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
  try { return new Date(t).toLocaleTimeString(); }
  catch { return t; }
}