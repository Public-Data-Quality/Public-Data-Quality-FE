async function buildDatasetSample(datasetFile, maxLines = 81) {
  if (!datasetFile || !datasetFile.name.toLowerCase().endsWith(".csv")) {
    return { csvSampleText: "", rowCountEstimate: null };
  }
  const text = await datasetFile.text();
  const lines = text.split(/\r?\n/);
  return {
    csvSampleText: lines.slice(0, maxLines).join("\n"),
    rowCountEstimate: Math.max(lines.filter((line) => line.trim()).length - 1, 0),
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-()[\]{}.,/\\|:;'"`~!@#$%^&*+=?<>]/g, "");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function looksLikeFlagColumn(name, topValues = []) {
  const normalized = normalizeText(name);
  const flagTokens = ["여부", "유무", "상태", "설치", "운영", "가능"];
  const flagValues = new Set(["y", "n", "yes", "no", "true", "false", "1", "0", "o", "x", "유", "무", "있음", "없음", "설치", "미설치"]);
  return (
    flagTokens.some((token) => normalized.includes(normalizeText(token))) ||
    topValues.some(([value]) => flagValues.has(String(value || "").trim().toLowerCase()))
  );
}

function inferColumnRole(column, derived) {
  const name = column?.raw_name || derived.name;
  const normalized = normalizeText(name);
  const numericParseRatio = column?.numeric_parse_ratio ?? derived.numericParseRatio;
  const distinctCount = column?.distinct_count ?? derived.distinctCount;
  const nonEmptyCount = column?.non_empty_count || derived.nonEmptyCount || 0;
  const topValues = derived.topValues || [];

  if (looksLikeFlagColumn(name, topValues)) return "flag_status";
  if (normalized.includes("코드") || normalized.includes("번호") || normalized.includes("id")) return "identifier_code";
  if (/(위도|latitude|lat)$/.test(normalized)) return "latitude";
  if (/(경도|longitude|lng|lon)$/.test(normalized)) return "longitude";
  if (normalized.includes("주소") || normalized.includes("위치") || normalized.includes("소재지")) return "address";
  if (
    normalized.includes("기관") ||
    normalized.includes("관리기관") ||
    normalized.includes("운영기관") ||
    normalized.includes("제공기관")
  ) {
    return "organization";
  }
  if (normalized.includes("일자") || normalized.includes("일시") || normalized.includes("날짜") || normalized.includes("년월") || normalized.includes("기간")) return "date";
  if (numericParseRatio >= 0.8) return "numeric_metric";
  if (distinctCount <= Math.max(30, Math.ceil(nonEmptyCount * 0.35))) {
    return "category";
  }
  return column?.semantic_profile_label || "text";
}

function looksLikeUsefulMetric(profile) {
  if (profile.role !== "numeric_metric" || profile.numeric_parse_ratio < 0.7) return false;
  const normalized = normalizeText(profile.name);
  if (/(전화|팩스|우편|우편번호|번호|코드|id|위도|경도|좌표)/.test(normalized)) return false;
  return /(수|건|대|량|금액|면적|거리|길이|높이|폭|용량|정원|인원|가격|요금|율|비율|점수|횟수|개수)/.test(normalized);
}

function looksLikeUsefulCategory(profile) {
  if (!["category", "organization"].includes(profile.role)) return false;
  const normalized = normalizeText(profile.name);
  if (/(주소|상세주소|소재지|전화|팩스|우편|홈페이지|url|링크|id|번호|코드)/.test(normalized)) return false;
  if (profile.distinct_count && profile.non_empty_count && profile.distinct_count > profile.non_empty_count * 0.8) return false;
  return true;
}

function buildDerivedColumnProfile(header, rows) {
  const counts = new Map();
  let nonEmptyCount = 0;
  let numericCount = 0;
  let dateCount = 0;
  const numericValues = [];

  for (const row of rows || []) {
    const rawValue = row?.[header];
    const value = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
    if (!value) continue;
    nonEmptyCount += 1;
    counts.set(value, (counts.get(value) || 0) + 1);

    const numberValue = toNumber(value);
    if (numberValue !== null) {
      numericCount += 1;
      numericValues.push(numberValue);
    }
    if (/^\d{4}[-./년]?\d{0,2}[-./월]?\d{0,2}/.test(value)) {
      dateCount += 1;
    }
  }

  const topValues = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return {
    name: header,
    nonEmptyCount,
    distinctCount: counts.size,
    topValues,
    numericParseRatio: nonEmptyCount ? numericCount / nonEmptyCount : 0,
    dateParseRatio: nonEmptyCount ? dateCount / nonEmptyCount : 0,
    numericMin: numericValues.length ? Math.min(...numericValues) : null,
    numericMax: numericValues.length ? Math.max(...numericValues) : null,
  };
}

function buildColumnProfiles({ headers, sampleRows, columns }) {
  const columnByName = new Map((columns || []).map((column) => [column.raw_name, column]));
  return (headers || []).map((header) => {
    const derived = buildDerivedColumnProfile(header, sampleRows || []);
    const column = columnByName.get(header) || {};
    const topValues = column.top_values?.length ? column.top_values.slice(0, 8) : derived.topValues;
    const profile = {
      name: header,
      normalized_name: column.normalized_name || normalizeText(header),
      role: inferColumnRole(column, { ...derived, topValues }),
      semantic_label: column.semantic_profile_label || "",
      semantic_description: column.semantic_profile_description || "",
      non_empty_count: column.non_empty_count ?? derived.nonEmptyCount,
      null_ratio: column.null_ratio ?? null,
      distinct_count: column.distinct_count ?? derived.distinctCount,
      numeric_parse_ratio: column.numeric_parse_ratio ?? derived.numericParseRatio,
      date_parse_ratio: column.date_parse_ratio ?? derived.dateParseRatio,
      numeric_min: column.numeric_min ?? derived.numericMin,
      numeric_max: column.numeric_max ?? derived.numericMax,
      sample_values: (column.sample_values || []).slice(0, 6),
      top_values: topValues,
    };
    return profile;
  });
}

function buildRelationshipCandidates(profiles) {
  const byRole = (role) => profiles.filter((profile) => profile.role === role);
  const categories = profiles.filter(looksLikeUsefulCategory);
  const addresses = byRole("address").filter((profile) => profile.non_empty_count > 0);
  const organizations = byRole("organization").filter((profile) => profile.non_empty_count > 0);
  const metrics = profiles.filter(looksLikeUsefulMetric);
  const flags = byRole("flag_status");
  const candidates = [];

  for (const category of categories.slice(0, 10)) {
    for (const metric of metrics.slice(0, 8)) {
      candidates.push({
        kind: "category_numeric",
        columns: [category.name, metric.name],
        evidence: `method_text는 반드시 '${category.name}'와 '${metric.name}'를 모두 포함해야 함. '${category.name}'별 '${metric.name}' 합계/평균/비율을 계산할 수 있음`,
      });
    }
    for (const flag of flags.slice(0, 8)) {
      candidates.push({
        kind: "category_flag_ratio",
        columns: [category.name, flag.name],
        evidence: `target_column은 '${flag.name}'여야 하며 method_text는 반드시 '${category.name}'와 '${flag.name}'를 모두 포함해야 함. '${category.name}'별 '${flag.name}' 긍정 건수와 비율을 계산할 수 있음`,
      });
    }
  }

  for (const organization of organizations.slice(0, 6)) {
    for (const address of addresses.slice(0, 4)) {
      candidates.push({
        kind: "organization_region_distribution",
        columns: [organization.name, address.name],
        evidence: `method_text는 반드시 '${organization.name}'와 '${address.name}'를 모두 포함해야 함. '${address.name}'에서 추출한 지역별 '${organization.name}' 분포를 집계할 수 있음`,
      });
    }
  }

  const latitude = profiles.find((profile) => profile.role === "latitude");
  const longitude = profiles.find((profile) => profile.role === "longitude");
  if (latitude && longitude) {
    candidates.push({
      kind: "spatial_distribution",
      columns: [latitude.name, longitude.name],
      evidence: "위도/경도 좌표가 함께 있어 공간 분포를 그릴 수 있음",
    });
  }

  const dateColumns = byRole("date");
  for (const dateColumn of dateColumns.slice(0, 4)) {
    candidates.push({
      kind: "time_trend",
      columns: [dateColumn.name],
      evidence: `${dateColumn.name}에서 연/월 단위 흐름을 계산할 수 있음`,
    });
  }

  return candidates.slice(0, 30);
}

function buildPlanningContext({ headers, sampleRows, columns }) {
  const columnProfiles = buildColumnProfiles({ headers, sampleRows, columns });
  return {
    column_profiles: columnProfiles,
    relationship_candidates: buildRelationshipCandidates(columnProfiles),
  };
}

async function postJson(url, body, fallbackMessage) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

function buildAnalysisCodePayload({ headers, sampleRows, columnName, methodText, llmModel, datasetSample }) {
  return {
    headers,
    sample_rows: sampleRows,
    csv_sample_text: datasetSample.csvSampleText,
    row_count_estimate: datasetSample.rowCountEstimate,
    column_name: columnName,
    method_text: methodText,
    llm_model: llmModel,
  };
}

export async function requestLlmAnalysisCode({ headers, sampleRows, columnName, methodText, llmModel, datasetFile }) {
  const datasetSample = await buildDatasetSample(datasetFile);
  return postJson(
    "/api/llm-analysis-code",
    buildAnalysisCodePayload({ headers, sampleRows, columnName, methodText, llmModel, datasetSample }),
    "LLM 분석 코드 요청에 실패했습니다.",
  );
}

export async function requestLlmAnalysisPlan({ headers, sampleRows, columns, llmModel, datasetFile }) {
  const datasetSample = await buildDatasetSample(datasetFile, 201);
  const planningContext = buildPlanningContext({ headers, sampleRows, columns });
  return postJson(
    "/api/llm-analysis-plan",
    {
      headers,
      sample_rows: sampleRows,
      ...planningContext,
      csv_sample_text: datasetSample.csvSampleText,
      row_count_estimate: datasetSample.rowCountEstimate,
      llm_model: llmModel,
    },
    "LLM 분석 항목 요청에 실패했습니다.",
  );
}

export async function repairLlmAnalysisCodeRuntime({
  headers,
  sampleRows,
  columnName,
  methodText,
  llmModel,
  datasetFile,
  previousCode,
  runtimeError,
}) {
  const datasetSample = await buildDatasetSample(datasetFile);
  return postJson(
    "/api/llm-analysis-code/repair-runtime",
    {
      ...buildAnalysisCodePayload({ headers, sampleRows, columnName, methodText, llmModel, datasetSample }),
      previous_code: previousCode,
      runtime_error: runtimeError,
    },
    "LLM 분석 코드 런타임 수정에 실패했습니다.",
  );
}
