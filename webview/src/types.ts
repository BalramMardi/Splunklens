export interface Credentials {
  splunkUrl: string;
  splunkToken: string;
  geminiKey: string;
}

export interface QueryResult {
  query: string;
  explanation: string;
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
  [key: string]: string | undefined;
}