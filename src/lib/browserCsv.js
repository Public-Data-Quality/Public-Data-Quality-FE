const MAX_BROWSER_ANALYSIS_BYTES = 2 * 1024 * 1024;
const MAX_BROWSER_ANALYSIS_ROWS = 2000;

export async function readCsvForBrowserAnalysis(datasetFile) {
  if (!datasetFile) throw new Error("분석할 원본 파일이 없습니다.");
  if (!datasetFile.name.toLowerCase().endsWith(".csv")) {
    throw new Error("브라우저 실행 분석은 현재 CSV 파일만 지원합니다.");
  }

  const csvText = await datasetFile.text();
  const lines = csvText.split(/\r?\n/);
  const nonEmptyRowCount = Math.max(lines.filter((line) => line.trim()).length - 1, 0);
  const overByteLimit = datasetFile.size > MAX_BROWSER_ANALYSIS_BYTES;
  const overRowLimit = nonEmptyRowCount > MAX_BROWSER_ANALYSIS_ROWS;

  if (!overByteLimit && !overRowLimit) {
    return { csvText, limited: false, rowCount: nonEmptyRowCount, usedRowCount: nonEmptyRowCount };
  }

  const header = lines[0] || "";
  const sampledRows = lines.slice(1, MAX_BROWSER_ANALYSIS_ROWS + 1);
  return {
    csvText: [header, ...sampledRows].join("\n"),
    limited: true,
    rowCount: nonEmptyRowCount,
    usedRowCount: sampledRows.filter((line) => line.trim()).length,
  };
}

export function appendBrowserLimitNotice(result, csvInfo) {
  if (!csvInfo?.limited || !result || typeof result !== "object") return result;
  const notice = `브라우저 안정성을 위해 전체 ${csvInfo.rowCount.toLocaleString()}행 중 앞 ${csvInfo.usedRowCount.toLocaleString()}행만 사용했습니다.`;
  return {
    ...result,
    summary: result.summary ? `${result.summary} ${notice}` : notice,
    metrics: {
      ...(result.metrics || {}),
      browser_limited_row_count: csvInfo.usedRowCount,
      browser_total_row_count: csvInfo.rowCount,
    },
  };
}
