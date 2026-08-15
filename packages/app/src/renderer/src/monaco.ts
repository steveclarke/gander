import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

/** Wires up Monaco's web worker so the editor doesn't fall back to the main thread. */
export function setupMonacoWorkers(): void {
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
}
