import { inferAnalysisType } from "./analysisTypes";
import { repairLlmAnalysisCodeRuntime, requestLlmAnalysisCode } from "./llmAnalysisApi";
import { runGeneratedPyodideAnalysis } from "./pyodideRuntime";

function normalizeAnalysisResult(result, analysisType) {
  if (!result || typeof result !== "object") {
    throw new Error("분석 결과 형식이 올바르지 않습니다.");
  }
  return {
    summary: result.summary || "분석을 완료했습니다.",
    metrics: result.metrics || {},
    ...result,
    analysisType,
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-()[\]{}.,/\\|:;'"`~!@#$%^&*+=<>?]/g, "");
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function isIdentifierLikeHeader(header) {
  return /번호|코드|전화|팩스|우편|식별|id|순번|일련/i.test(header);
}

function isMetricHeaderForMethod(header, method) {
  if (isIdentifierLikeHeader(header)) return false;
  const normalizedHeader = normalizeText(header);
  const normalizedMethod = normalizeText(method);
  const metricTokens = ["대수", "건수", "수량", "개수", "금액", "면적", "정원", "좌석", "설치", "cctv"];
  return metricTokens.some((token) => normalizedHeader.includes(normalizeText(token)) && normalizedMethod.includes(normalizeText(token)));
}

function sampleHasPositiveRelatedMetric(headers, sampleRows, method) {
  const metricHeaders = (headers || []).filter((header) => isMetricHeaderForMethod(header, method));
  return metricHeaders.some((header) =>
    (sampleRows || []).some((row) => {
      const number = toNumber(row?.[header]);
      return number !== null && number > 0;
    }),
  );
}

function hasSuspiciousZeroMetric(result, method) {
  if (methodLooksLikeFlagRatio(method)) return false;
  const metrics = result?.metrics || {};
  const methodNeedsNumericMetric = /대수|건수|수량|개수|합계|비율|설치|cctv/i.test(method || "");
  if (!methodNeedsNumericMetric) return false;

  const metricEntries = Object.entries(metrics).filter(([key, value]) => {
    if (typeof value !== "number") return false;
    return /total|sum|합계|install|설치|대수|count/i.test(key);
  });
  if (metricEntries.some(([, value]) => value > 0)) return false;
  if (metricEntries.some(([, value]) => value === 0)) return true;

  const visualizationRows = result?.visualization?.rows || result?.visualization?.bins || [];
  if (Array.isArray(visualizationRows) && visualizationRows.length) {
    return visualizationRows.every((row) => Number(row?.value ?? row?.count) === 0);
  }

  return false;
}

function methodLooksLikeFlagRatio(method) {
  return /여부|유무|설치\s*비율|비율\s*분석|설치율|상태별|종류별/i.test(method || "");
}

function hasWrongNumericColumnFailure(result, method) {
  const summary = String(result?.summary || "");
  return methodLooksLikeFlagRatio(method) && /계량형|숫자\s*컬럼|수치\s*컬럼|numeric/i.test(summary);
}

function hasWrongCategoryColumnFailure(result, method) {
  const summary = String(result?.summary || "");
  return methodLooksLikeFlagRatio(method) && /카테고리\s*컬럼|범주\s*컬럼|분류\s*컬럼|종류\s*컬럼|category/i.test(summary);
}

function mentionedHeaders(headers, method, columnName) {
  const normalizedMethod = normalizeText(method);
  const allowed = new Set([columnName]);
  for (const header of headers || []) {
    const normalizedHeader = normalizeText(header);
    if (normalizedHeader.length >= 2 && normalizedMethod.includes(normalizedHeader)) {
      allowed.add(header);
    }
  }
  return allowed;
}

function resultDescriptorText(result) {
  const visualization = result?.visualization || {};
  const parts = [
    result?.summary,
    visualization.title,
    visualization.x_label,
    visualization.y_label,
  ];
  if (Array.isArray(visualization.charts)) {
    for (const chart of visualization.charts) {
      parts.push(chart?.title, chart?.x_label, chart?.y_label);
    }
  }
  return parts.filter(Boolean).join(" ");
}

function disallowedHeaderMention(result, headers, method, columnName) {
  const allowed = mentionedHeaders(headers, method, columnName);
  const descriptor = normalizeText(resultDescriptorText(result));
  for (const header of headers || []) {
    if (allowed.has(header)) continue;
    const normalizedHeader = normalizeText(header);
    if (normalizedHeader.length >= 2 && descriptor.includes(normalizedHeader)) {
      return header;
    }
  }
  return "";
}

function assertMeaningfulAnalysisResult({ result, headers, sampleRows, method, columnName }) {
  if (hasSuspiciousZeroMetric(result, method) && sampleHasPositiveRelatedMetric(headers, sampleRows, method)) {
    throw new Error(
      "논리 검증 실패: 관련 수치 컬럼 샘플에는 양수 값이 있는데 분석 결과의 합계가 0입니다. 컬럼명을 공백 제거 방식으로 다시 매칭하고 수치 합계/비율을 재계산하세요.",
    );
  }
  if (hasWrongNumericColumnFailure(result, method) || (/여부|유무/i.test(columnName || "") && /계량형|숫자\s*컬럼|수치\s*컬럼|numeric/i.test(String(result?.summary || "")))) {
    throw new Error(
      "논리 검증 실패: 이 분석은 계량형 컬럼이 필요한 분석이 아닙니다. 대상 여부/상태 컬럼을 기준으로 관련 범주 컬럼별 전체 건수, 설치/긍정 건수, 비율을 계산하세요.",
    );
  }
  if (hasWrongCategoryColumnFailure(result, method)) {
    throw new Error(
      "논리 검증 실패: 관련 카테고리 컬럼을 찾지 못했습니다. method_text의 '시설 종류'는 헤더의 '시설종류', '시설유형', '시설구분', '시설분류' 같은 컬럼과 공백/특수문자 제거 방식으로 매칭하세요.",
    );
  }
  const wrongHeader = disallowedHeaderMention(result, headers, method, columnName);
  if (wrongHeader) {
    throw new Error(
      `논리 검증 실패: 분석 결과가 요청하지 않은 컬럼 '${wrongHeader}'을 사용한 것으로 보입니다. method_text에 명시된 컬럼과 대상 컬럼 '${columnName}'만 사용해서 다시 분석하세요.`,
    );
  }
}

export async function runColumnAnalysis({
  headers,
  sampleRows,
  column,
  method,
  datasetFile,
  useLlm,
  llmModel,
}) {
  const analysisType = inferAnalysisType(method, column);
  const baseMeta = { columnName: column.raw_name, method, analysisType };

  if (!useLlm) {
    throw new Error("LLM 분석이 꺼져 있어 분석 코드를 생성할 수 없습니다.");
  }

  try {
    const generated = await requestLlmAnalysisCode({
      headers,
      sampleRows,
      columnName: column.raw_name,
      methodText: method,
      llmModel,
      datasetFile,
    });

    let generatedResult;
    let generatedTitle = generated.title;
    try {
      generatedResult = await runGeneratedPyodideAnalysis({
        datasetFile,
        columnName: column.raw_name,
        methodText: method,
        generatedCode: generated.code,
      });
      generatedResult.columnName = column.raw_name;
      assertMeaningfulAnalysisResult({ result: generatedResult, headers, sampleRows, method, columnName: column.raw_name });
    } catch (runtimeErr) {
      const repaired = await repairLlmAnalysisCodeRuntime({
        headers,
        sampleRows,
        columnName: column.raw_name,
        methodText: method,
        llmModel,
        datasetFile,
        previousCode: generated.code,
        runtimeError: runtimeErr.message || String(runtimeErr),
      });
      generatedResult = await runGeneratedPyodideAnalysis({
        datasetFile,
        columnName: column.raw_name,
        methodText: method,
        generatedCode: repaired.code,
      });
      generatedResult.columnName = column.raw_name;
      assertMeaningfulAnalysisResult({ result: generatedResult, headers, sampleRows, method, columnName: column.raw_name });
      generatedTitle = repaired.title || generatedTitle;
    }

    return {
      result: normalizeAnalysisResult(generatedResult, "llm_generated"),
      meta: { columnName: column.raw_name, method, analysisType: "llm_generated", title: generatedTitle },
      warning: "",
    };
  } catch (llmErr) {
    throw new Error(`LLM 분석 실행 실패: ${llmErr.message}`);
  }
}
