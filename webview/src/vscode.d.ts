interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    vscodeApi: VSCodeApi;
  }
}

export {};