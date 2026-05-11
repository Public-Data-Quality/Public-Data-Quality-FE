let pyodideReadyPromise = null;

function loadPyodideRuntime() {
  if (pyodideReadyPromise) return pyodideReadyPromise;
  pyodideReadyPromise = importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
  pyodideReadyPromise = self.loadPyodide();
  return pyodideReadyPromise;
}

self.onmessage = async (event) => {
  const { id, code } = event.data || {};
  try {
    const pyodide = await loadPyodideRuntime();
    const output = await pyodide.runPythonAsync(code);
    self.postMessage({ id, ok: true, output });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || "",
    });
  }
};
