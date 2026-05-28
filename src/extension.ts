import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";

// ─── Constants ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Splunk SPL expert. Convert natural language to SPL.

Index: Use index=main unless user names another index (e.g. "botsv3" → index=botsv3).

Time range:
- "last Nh" → earliest=-Nh (e.g. "last 10 hours" → earliest=-10h)
- "today" → earliest=-24h
- "last 7 days" → earliest=-7d
- "all time" / "everything" / "ever" → omit earliest entirely
- nothing mentioned → earliest=-1h

Commands allowed: search, stats, table, sort, where, eval, rex, head, tail, timechart, fields
Commands forbidden: delete, drop, outputlookup, sendemail, rest, script

Default ending: | table _time event_type severity src_ip user message
Exception: if user asks for counts or stats, use appropriate stats command instead.

Return ONLY this JSON, no markdown, no extra text:
{"query":"<SPL>","explanation":"<one sentence>"}

Examples:
User: failed logins last 2 hours
{"query":"index=main event_type=\"login_failed\" earliest=-2h | table _time event_type severity src_ip user message","explanation":"Failed logins in the last 2 hours."}
User: errors in botsv3 all time
{"query":"index=botsv3 | table _time event_type severity src_ip user message","explanation":"All events in botsv3 across all time."}
User: count events by type today
{"query":"index=main earliest=-24h | stats count by event_type | sort -count","explanation":"Event counts by type today."}`;

const DANGEROUS_COMMANDS = [
  "delete", "drop", "outputlookup",
  "sendemail", "rest", "script"
];

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  console.log("SplunkLens is now active");

  const provider = new SplunkLensViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SplunkLensViewProvider.viewType,
      provider
    )
  );
}

export function deactivate() {}

// ─── Webview Provider ─────────────────────────────────────────────────────────

class SplunkLensViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "splunklens.view";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._context.extensionUri, "webview-dist")
      ]
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(
      msg => this._handleMessage(msg, webviewView.webview),
      undefined,
      this._context.subscriptions
    );
  }

  // ─── Message Handler ───────────────────────────────────────────────────────

  private async _handleMessage(
    msg: { type: string; payload?: any },
    webview: vscode.WebviewView["webview"]
  ) {
    switch (msg.type) {

      case "CHECK_CREDENTIALS": {
        const splunkUrl   = await this._context.secrets.get("splunkUrl");
        const splunkToken = await this._context.secrets.get("splunkToken");
        const geminiKey   = await this._context.secrets.get("geminiKey");

        if (splunkUrl && splunkToken && geminiKey) {
          webview.postMessage({ type: "CREDENTIALS_EXIST" });
        } else {
          webview.postMessage({ type: "CREDENTIALS_MISSING" });
        }
        break;
      }

      case "SAVE_CREDENTIALS": {
        const { splunkUrl, splunkToken, geminiKey } = msg.payload;
        await this._context.secrets.store("splunkUrl",   splunkUrl);
        await this._context.secrets.store("splunkToken", splunkToken);
        await this._context.secrets.store("geminiKey",   geminiKey);
        vscode.window.showInformationMessage(
          "SplunkLens: Credentials saved securely."
        );
        break;
      }

      case "SUBMIT_QUERY": {
        await this._handleQuery(msg.payload.query, webview);
        break;
      }

	  case "CLEAR_CREDENTIALS": {
		await this._context.secrets.delete("splunkUrl");
		await this._context.secrets.delete("splunkToken");
		await this._context.secrets.delete("geminiKey");
		vscode.window.showInformationMessage(
			"SplunkLens: Credentials cleared."
		);
		break;
	  }
    }
  }

  // ─── Core Query Pipeline ───────────────────────────────────────────────────

  private async _handleQuery(
    naturalLanguage: string,
    webview: vscode.WebviewView["webview"]
  ) {
    try {
      // Step 1 — load credentials from SecretStorage
      const splunkUrl   = await this._context.secrets.get("splunkUrl");
      const splunkToken = await this._context.secrets.get("splunkToken");
      const geminiKey   = await this._context.secrets.get("geminiKey");

      if (!splunkUrl || !splunkToken || !geminiKey) {
        webview.postMessage({
          type: "QUERY_ERROR",
          payload: { message: "Credentials not found. Please run setup again." }
        });
        return;
      }

      // Step 2 — call Gemini to translate natural language to SPL
      const { query, explanation } = await this._callGemini(
        naturalLanguage,
        geminiKey
      );

      // Step 3 — validate SPL for dangerous commands
      const foundDangerous = DANGEROUS_COMMANDS.find(cmd =>
        query.toLowerCase().includes(cmd)
      );
      if (foundDangerous) {
        webview.postMessage({
          type: "QUERY_ERROR",
          payload: {
            message: `Generated query contains unsafe command: ${foundDangerous}`
          }
        });
        return;
      }

      // Step 4 — run SPL against Splunk
      const events = await this._querySplunk(query, splunkUrl, splunkToken);

      // Step 5 — send results back to webview
      webview.postMessage({
        type: "QUERY_RESULTS",
        payload: {
          query,
          explanation,
          events,
          resultCount: events.length,
          timeRange: extractTimeRange(query)
        }
      });

    } catch (err: unknown) {
      webview.postMessage({
        type: "QUERY_ERROR",
        payload: {
          message: err instanceof Error ? err.message : "Unknown error occurred."
        }
      });
    }
  }

  // ─── Gemini API Call ───────────────────────────────────────────────────────

  private async _callGemini(
    naturalLanguage: string,
    geminiKey: string
  ): Promise<{ query: string; explanation: string }> {

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`;

    const body = JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [{ parts: [{ text: naturalLanguage }] }]
    });

    const rawText = await httpsPost(url, body, {
      "Content-Type": "application/json"
    });

    const data = JSON.parse(rawText);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini returned no response. Check your API key.");
    }

    // Strip markdown code fences if Gemini adds them despite instructions
    const cleaned = text.replace(/```json|```/g, "").trim();

    let parsed: { query: string; explanation: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 100)}`);
    }

    if (!parsed.query || !parsed.explanation) {
      throw new Error("Gemini response missing query or explanation field.");
    }

    return parsed;
  }

  // ─── Splunk Query ──────────────────────────────────────────────────────────

  private async _querySplunk(
    spl: string,
    splunkUrl: string,
    splunkToken: string
  ): Promise<any[]> {

    const url = `${splunkUrl}/services/search/jobs/export`;

    const params = new URLSearchParams({
      search: spl.startsWith("search ") ? spl : `search ${spl}`,
      output_mode: "json",
      count: "10"
    });

    const rawText = await httpsPost(
      url,
      params.toString(),
      {
        "Authorization": `Splunk ${splunkToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      // Accept self-signed certificates for localhost Splunk
      false
    );

    // Splunk /export returns one JSON object per line (NDJSON format)
    const events: any[] = [];
    const lines = rawText.split("\n").filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Only include result rows, skip preview/summary rows
        if (parsed.result) {
          events.push(parsed.result);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return events;
  }

  // ─── HTML Builder ──────────────────────────────────────────────────────────

  private _getHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(
      this._context.extensionUri,
      "webview-dist"
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "assets", "index.js")
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "assets", "index.css")
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';
             connect-src https://generativelanguage.googleapis.com;">
  <link rel="stylesheet" href="${styleUri}"/>
  <title>SplunkLens</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
  rejectUnauthorized = true
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body)
      },
      rejectUnauthorized: isHttps ? rejectUnauthorized : undefined
    };

    const req = lib.request(options as any, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(
            `HTTP ${res.statusCode}: ${data.slice(0, 200)}`
          ));
        } else {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractTimeRange(spl: string): string {
  const match = spl.match(/earliest=([^\s|]+)/);
  if (!match) { return "all time"; }
  const val = match[1];
  const map: Record<string, string> = {
    "-1h":  "last 1 hour",
    "-2h":  "last 2 hours",
    "-6h":  "last 6 hours",
    "-10h": "last 10 hours",
    "-24h": "last 24 hours",
    "-7d":  "last 7 days",
    "-30d": "last 30 days",
    "@d":   "today",
    "@w":   "this week",
    "@mon": "this month"
  };
  return map[val] ?? val;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}