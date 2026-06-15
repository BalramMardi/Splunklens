import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as https from "https";

const SYSTEM_PROMPT = `Role: Splunk SPL Expert. Convert NL to SPL.
Rules:
- Omit index unless specified.
- Escape double quotes: event_type=\"login_failed\"
- Start query with "search "
Time: "last Nh"=-Nh, "today"=-24h, "last 7 days"=-7d, "all time"=0, empty=-1h
Allowed: search, stats, table, sort, where, eval, rex, head, tail, timechart, fields
Default end: | head 50 | table _time event_type severity src_ip user message (unless stats/count).
Output ONLY JSON: {"query":"<SPL>"}

Ex:
User: failed logins last 2 hours
{"query":"search event_type=\"login_failed\" earliest=-2h | head 50 | table _time event_type severity src_ip user message"}`;

const DANGEROUS_COMMANDS = [
  "delete", "drop", "outputlookup",
  "sendemail", "rest", "script"
];

export function activate(context: vscode.ExtensionContext) {
  const provider = new SplunkLensViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SplunkLensViewProvider.viewType,
      provider
    )
  );
}

export function deactivate() {}

class SplunkLensViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "splunklens.view";
  private _view?: vscode.WebviewView;
  private _mcpClient?: Client;
  private _currentAbortController?: AbortController;

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

    webviewView.webview.onDidReceiveMessage(
      msg => this._handleMessage(msg, webviewView.webview),
      undefined,
      this._context.subscriptions
    );
  }

  private async _handleMessage(
    msg: { type: string; payload?: Record<string, unknown> },
    webview: vscode.WebviewView["webview"]
  ) {
    switch (msg.type) {
      case "CHECK_CREDENTIALS": {
        const splunkUrl    = await this._context.secrets.get("splunkUrl");
        const splunkWebUrl = await this._context.secrets.get("splunkWebUrl");
        const mcpToken     = await this._context.secrets.get("mcpToken");
        const geminiKey    = await this._context.secrets.get("geminiKey");
        if (splunkUrl && splunkWebUrl && mcpToken && geminiKey) {
          webview.postMessage({ type: "CREDENTIALS_EXIST" });
        } else {
          webview.postMessage({ type: "CREDENTIALS_MISSING" });
        }
        break;
      }

      case "SAVE_CREDENTIALS": {
        if (!msg.payload) return;
        const { splunkUrl, splunkWebUrl, mcpToken, geminiKey } = msg.payload as Record<string, string>;
        await this._context.secrets.store("splunkUrl", splunkUrl);
        await this._context.secrets.store("splunkWebUrl", splunkWebUrl);
        await this._context.secrets.store("mcpToken",  mcpToken);
        await this._context.secrets.store("geminiKey", geminiKey);
        this._mcpClient = undefined;
        vscode.window.showInformationMessage("SplunkLens: Credentials saved securely.");
        break;
      }

      case "CLEAR_CREDENTIALS": {
        await this._context.secrets.delete("splunkUrl");
        await this._context.secrets.delete("splunkWebUrl");
        await this._context.secrets.delete("mcpToken");
        await this._context.secrets.delete("geminiKey");
        this._mcpClient = undefined;
        vscode.window.showInformationMessage("SplunkLens: Credentials cleared.");
        break;
      }

      case "SUBMIT_QUERY": {
        if (!msg.payload || typeof msg.payload.query !== "string") return;
        const model = typeof msg.payload.model === "string" ? msg.payload.model : "gemini-2.5-flash";
        await this._handleQuery(msg.payload.query, model, webview);
        break;
      }

      case "CANCEL_QUERY": {
        if (this._currentAbortController) {
          this._currentAbortController.abort();
          this._currentAbortController = undefined;
        }
        break;
      }

      case "OPEN_IN_SPLUNK": {
        const splunkWebUrl = await this._context.secrets.get("splunkWebUrl");
        if (splunkWebUrl && msg.payload && typeof msg.payload.query === "string") {
          const encodedSpl = encodeURIComponent(msg.payload.query);
          const fullUrl = `${splunkWebUrl}/en-US/app/search/search?q=${encodedSpl}`;
          vscode.env.openExternal(vscode.Uri.parse(fullUrl));
        }
        break;
      }

      case "EXPORT_CSV": {
        if (!msg.payload) return;
        const events = msg.payload.events as Record<string, unknown>[];
        if (!events || events.length === 0) {
          vscode.window.showErrorMessage("No events to export.");
          break;
        }

        const uri = await vscode.window.showSaveDialog({
          filters: { "CSV Files": ["csv"] },
          defaultUri: vscode.Uri.file("splunk_results.csv")
        });

        if (uri) {
          try {
            const keys = Array.from(new Set(events.flatMap(e => Object.keys(e))));
            let csv = keys.join(",") + "\n";

            for (const event of events) {
              const row = keys.map(key => {
                let rawVal = event[key];
                
                if (rawVal === null || rawVal === undefined) {
                  return "";
                }
                
                let strVal: string;
                if (typeof rawVal === "object") {
                  strVal = JSON.stringify(rawVal);
                } else {
                  strVal = String(rawVal);
                }
                
                strVal = strVal.replace(/"/g, '""');
                
                if (strVal.includes(",") || strVal.includes('"') || strVal.includes("\n")) {
                  return `"${strVal}"`;
                }
                
                return strVal;
              });
              csv += row.join(",") + "\n";
            }

            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(csv));
            vscode.window.showInformationMessage("SplunkLens: CSV exported successfully.");
          } catch (e) {
            vscode.window.showErrorMessage("SplunkLens: Failed to export CSV.");
          }
        }
        break;
      }
    }
  }

  private async _getMCPClient(): Promise<Client> {
    if (this._mcpClient) {
      return this._mcpClient;
    }

    const splunkUrl = await this._context.secrets.get("splunkUrl");
    const mcpToken  = await this._context.secrets.get("mcpToken");

    if (!splunkUrl || !mcpToken) {
      throw new Error("Credentials not found. Please run setup again.");
    }

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const transport = new StreamableHTTPClientTransport(
      new URL(`${splunkUrl}/services/mcp`),
      {
        requestInit: {
          headers: {
            "Authorization": `Bearer ${mcpToken}`
          }
        }
      }
    );

    const client = new Client(
      { name: "splunklens", version: "1.0.0" },
      {}
    );

    await client.connect(transport);
    this._mcpClient = client;
    return client;
  }

  private async _handleQuery(
    naturalLanguage: string,
    model: string,
    webview: vscode.WebviewView["webview"]
  ) {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    
  
    this._currentAbortController = new AbortController();
    const signal = this._currentAbortController.signal;

  
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(new Error("Query cancelled by user."));
      signal.addEventListener("abort", () => reject(new Error("Query cancelled by user.")));
    });

    try {
      const geminiKey = await this._context.secrets.get("geminiKey");

      if (!geminiKey) {
        throw new Error("Gemini API key not found. Please run setup again.");
      }

      webview.postMessage({
        type: "QUERY_STATUS",
        payload: { message: `Translating query with ${model}...` }
      });

   
      const { query } = await Promise.race([
        this._callGemini(naturalLanguage, model, geminiKey, signal),
        abortPromise
      ]);

      const foundDangerous = DANGEROUS_COMMANDS.find(cmd =>
        query.toLowerCase().includes(cmd)
      );
      if (foundDangerous) {
        throw new Error(
          `Query contains unsafe command: ${foundDangerous}. Try rephrasing.`
        );
      }

      webview.postMessage({
        type: "QUERY_STATUS",
        payload: { message: "Searching Splunk via MCP..." }
      });

      const client = await this._getMCPClient();

      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error(
          "Query timed out. Try adding a narrower time range."
        )), 20000);
      });

     
      const queryResult = await Promise.race([
        client.callTool({
          name: "splunk_run_query",
          arguments: { query }
        }),
        timeout,
        abortPromise
      ]);

      const events = parseQueryResults(queryResult);

      webview.postMessage({
        type: "QUERY_RESULTS",
        payload: {
          query,
          events,
          resultCount: events.length,
          timeRange: extractTimeRange(query)
        }
      });

    } catch (err: unknown) {
      let errorMessage = "Unknown error occurred.";
      if (err instanceof Error) {
        // Suppress standard abort errors into a cleaner message if needed
        errorMessage = err.name === "AbortError" ? "Query cancelled by user." : err.message;
      }
      
      webview.postMessage({
        type: "QUERY_ERROR",
        payload: { message: errorMessage }
      });
    } finally {
      if (timerId) clearTimeout(timerId);
      this._currentAbortController = undefined;
    }
  }

  private async _callGemini(
    naturalLanguage: string,
    model: string,
    geminiKey: string,
    signal: AbortSignal
  ): Promise<{ query: string }> {

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const body = JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [{ parts: [{ text: naturalLanguage }] }]
    });

    let rawText: string;
    try {
      rawText = await httpsPost(url, body, {
        "Content-Type": "application/json"
      }, signal);
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      if (e.message?.includes("HTTP 404")) {
        throw new Error(`You do not have the model '${model}' in your Gemini package, or it does not exist.`);
      }
      if (e.message?.includes("HTTP 429")) {
        throw new Error("Your Gemini model quota is exhausted. Please try again later.");
      }
      throw e;
    }

    const data = JSON.parse(rawText);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini returned no response. Check your API key.");
    }

    const cleaned = text.replace(/```json|```/g, "").trim();

    let query = "";

    try {
      const parsed = JSON.parse(cleaned);
      query = parsed.query;
    } catch {
      const queryMatch = cleaned.match(/"query"\s*:\s*"([\s\S]*?)"/);

      if (queryMatch) {
        query = queryMatch[1].trim();
      } else {
        const splMatch = cleaned.match(/search[\s\S]*?(?=",|"}|$)/);
        if (splMatch) {
          query = splMatch[0].trim();
        } else {
          throw new Error(
            `Gemini returned invalid JSON: ${cleaned.slice(0, 100)}`
          );
        }
      }
    }

    if (!query) {
      throw new Error("Gemini response missing query field.");
    }

    return { query };
  }

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
             script-src 'nonce-${nonce}';">
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

function parseQueryResults(result: unknown): Record<string, unknown>[] {
  try {
    const resObj = result as Record<string, unknown>;
    const content = resObj?.content;
    if (!content || !Array.isArray(content)) { return []; }

    for (const block of content) {
      if (block.type === "text" && block.text) {
        const text: string = block.text;

        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) { return parsed; }
          if (parsed.results && Array.isArray(parsed.results)) {
            return parsed.results;
          }
        } catch { }

        const lines = text.split("\n").filter((l: string) => l.trim());
        const events: Record<string, unknown>[] = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.result)  { events.push(parsed.result); }
            else if (parsed._time) { events.push(parsed); }
          } catch { }
        }
        if (events.length > 0) { return events; }
      }
    }
    return [];
  } catch {
    return [];
  }
}

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body)
      },
      signal
    };

    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
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