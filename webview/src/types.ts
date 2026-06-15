export interface Credentials {
  splunkUrl: string;
  splunkWebUrl: string;
  mcpToken: string;
  geminiKey: string;
}

export interface QueryResult {
  query: string;
  events: SplunkEvent[];
  resultCount: number;
  timeRange: string;
}

export interface SplunkEvent {
  _time: string;
  event_type?: string;
  severity?: string;
  message?: string;
  src_ip?: string;
  user?: string;
  [key: string]: unknown;
}