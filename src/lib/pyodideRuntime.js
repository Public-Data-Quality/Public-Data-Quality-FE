import { appendBrowserLimitNotice, readCsvForBrowserAnalysis } from "./browserCsv";

let worker = null;
let nextRequestId = 1;
const pendingRequests = new Map();
const PYODIDE_EXECUTION_TIMEOUT_MS = 25000;

function rejectAllPending(error) {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function resetWorker() {
  worker?.terminate();
  worker = null;
}

function getPyodideWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/pyodideWorker.js", import.meta.url));
  worker.onmessage = (event) => {
    const { id, ok, output, error, stack } = event.data || {};
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    clearTimeout(pending.timeoutId);
    if (ok) {
      pending.resolve(output);
      return;
    }
    const err = new Error(error || "Pyodide worker 실행에 실패했습니다.");
    err.stack = stack || err.stack;
    pending.reject(err);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Pyodide worker 오류가 발생했습니다.");
    rejectAllPending(error);
    resetWorker();
  };
  worker.onmessageerror = () => {
    rejectAllPending(new Error("Pyodide worker 메시지 처리 중 오류가 발생했습니다."));
    resetWorker();
  };
  return worker;
}

export function runPythonInWorker(code) {
  const id = nextRequestId++;
  const pyodideWorker = getPyodideWorker();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      resetWorker();
      reject(new Error("브라우저 Python 분석이 25초를 초과해 중단되었습니다. 더 작은 데이터 샘플로 다시 실행하세요."));
    }, PYODIDE_EXECUTION_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timeoutId });
    pyodideWorker.postMessage({ id, code });
  });
}

export async function runGeneratedPyodideAnalysis({ datasetFile, columnName, methodText, generatedCode }) {
  const csvInfo = await readCsvForBrowserAnalysis(datasetFile);
  const csvText = csvInfo.csvText;
  const code = `
import csv, io, json, math, re, statistics
from collections import Counter, defaultdict
from statistics import mean, median

csv_text = ${JSON.stringify(csvText)}
column_name = ${JSON.stringify(columnName)}
method_text = ${JSON.stringify(methodText)}
analysis_code = ${JSON.stringify(generatedCode)}

rows = list(csv.DictReader(io.StringIO(csv_text)))
headers = list(rows[0].keys()) if rows else []
allowed_builtins = {
    "len": len,
    "sum": sum,
    "min": min,
    "max": max,
    "round": round,
    "sorted": sorted,
    "str": str,
    "int": int,
    "float": float,
    "list": list,
    "dict": dict,
    "set": set,
    "tuple": tuple,
    "enumerate": enumerate,
    "range": range,
    "next": next,
    "iter": iter,
    "isinstance": isinstance,
    "abs": abs,
    "any": any,
    "all": all,
    "zip": zip,
    "Exception": Exception,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "KeyError": KeyError,
}
scope = {
    "__builtins__": allowed_builtins,
    "Counter": Counter,
    "defaultdict": defaultdict,
    "math": math,
    "re": re,
    "statistics": statistics,
    "mean": mean,
    "median": median,
}
exec(analysis_code, scope)
result = scope["analyze"](rows, headers, column_name, method_text)
json.dumps(result, ensure_ascii=False)
`;
  const output = await runPythonInWorker(code);
  return appendBrowserLimitNotice(JSON.parse(output), csvInfo);
}
