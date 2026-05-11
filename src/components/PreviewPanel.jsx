import { useEffect, useState } from "react";
import { AnalysisVisualization } from "./AnalysisVisualization";
import { inferAnalysisType } from "../lib/analysisTypes";
import { runColumnAnalysis } from "../lib/columnAnalysisRunner";
import { requestLlmAnalysisPlan } from "../lib/llmAnalysisApi";
import {
  buildColumnSummary,
  formatAnalysisType,
  formatConfidence,
  formatCriterionName,
  formatFindingType,
  formatMatchType,
  formatPercent,
} from "../lib/formatters";

function buildCellIssueMap(findings) {
  const issueMap = new Map();

  for (const finding of findings || []) {
    if (!finding.row_indexes?.length) continue;
    const relatedColumns = finding.related_columns?.length ? finding.related_columns : [finding.column_name];
    for (const rowIndex of finding.row_indexes) {
      for (const columnName of relatedColumns) {
        const key = `${rowIndex}::${columnName}`;
        const bucket = issueMap.get(key) || [];
        bucket.push(finding);
        issueMap.set(key, bucket);
      }
    }
  }

  return issueMap;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join(", ") : "-";
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? entries.map(([key, nestedValue]) => `${key}: ${displayValue(nestedValue)}`).join(" / ") : "-";
  }
  return String(value);
}

function formatCount(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("ko-KR");
}

function buildValueDistributionRows(column) {
  if (!column?.top_values?.length) return [];
  const denominator = column.non_empty_count || column.top_values.reduce((sum, [, count]) => sum + count, 0);
  const rows = column.top_values.slice(0, 5).map(([value, count]) => ({
    label: value || "(빈 값)",
    count: Number(count) || 0,
    ratio: denominator ? (Number(count) || 0) / denominator : 0,
  }));
  const shownCount = rows.reduce((sum, row) => sum + row.count, 0);
  const otherCount = Math.max((column.non_empty_count || shownCount) - shownCount, 0);
  if (otherCount > 0) {
    rows.push({
      label: "기타",
      count: otherCount,
      ratio: denominator ? otherCount / denominator : 0,
    });
  }
  return rows;
}

function ColumnValueDonut({ column }) {
  const rows = buildValueDistributionRows(column).filter((row) => row.count > 0);
  if (!rows.length) return "-";
  const colors = ["#1f6f5b", "#11284d", "#b16c08", "#8b5cf6", "#0f766e", "#64748b"];
  let cursor = 0;
  const gradient = rows
    .map((row, index) => {
      const start = cursor;
      const end = cursor + row.ratio * 100;
      cursor = end;
      return `${colors[index % colors.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="column-donut-panel">
      <div className="column-donut-chart" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="column-donut-center">
          <strong>{formatCount(column.non_empty_count)}</strong>
          <span>유효값</span>
        </div>
      </div>
      <div className="column-donut-legend">
        {rows.map((row, index) => (
          <div className="column-donut-legend-row" key={`${row.label}-${row.count}`}>
            <span className="column-donut-swatch" style={{ background: colors[index % colors.length] }} />
            <span className="column-donut-label" title={row.label}>{row.label}</span>
            <span>{formatCount(row.count)}건</span>
            <span>{Math.round(row.ratio * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function standardMappingText(column) {
  if (!column) return "표준용어 정보 없음";
  const candidate = column.standard_candidates?.[0];
  const matchType = formatMatchType(column.standard_match_type);
  if (!candidate) return "표준용어 미매핑";
  return `${candidate} · ${matchType}`;
}

function normalizedColumnName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function hasDifferentStandardTerm(column) {
  const candidate = column?.standard_candidates?.[0];
  if (!candidate) return false;
  return normalizedColumnName(candidate) !== normalizedColumnName(column.raw_name);
}

function StandardMappingBadge({ column }) {
  if (!hasDifferentStandardTerm(column)) return null;
  const candidate = column?.standard_candidates?.[0];
  const matchType = formatMatchType(column?.standard_match_type);

  return (
    <span
      className="standard-mapping-badge is-mapped"
      title={standardMappingText(column)}
    >
      <span className="standard-mapping-term">{candidate}</span>
      <span className="standard-mapping-type">{matchType}</span>
    </span>
  );
}

function normalizeLlmInsightItems(items, columns) {
  const safeColumns = columns || [];
  return (items || [])
    .map((item, index) => {
      const column = safeColumns.find((candidate) => candidate.raw_name === item.target_column);
      if (!column || !item.method_text) return null;
      return {
        key: `${column.raw_name}::llm-insight-${index}`,
        column,
        title: item.title || "LLM 추천 분석",
        method: item.method_text,
        analysisType: inferAnalysisType(item.method_text, column),
        visualizationHint: item.visualization_hint,
      };
    })
    .filter(Boolean);
}

export function PreviewPanel({
  headers,
  rows,
  columns,
  findings,
  datasetFile,
  useLlm,
  llmModel,
}) {
  const safeHeaders = headers || [];
  const safeRows = rows || [];
  const safeColumns = columns || [];
  const safeFindings = findings || [];
  const [hoveredColumnName, setHoveredColumnName] = useState(safeHeaders[0] || "");
  const [analysisResults, setAnalysisResults] = useState({});
  const [analysisLoadingKey, setAnalysisLoadingKey] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [activeAnalysisKey, setActiveAnalysisKey] = useState("");
  const [activeAnalysisMeta, setActiveAnalysisMeta] = useState(null);
  const [insightAnalysisItems, setInsightAnalysisItems] = useState([]);
  const [insightPlanLoading, setInsightPlanLoading] = useState(false);
  const [insightPlanError, setInsightPlanError] = useState("");
  const hoveredColumn = safeColumns.find((column) => column.raw_name === hoveredColumnName) || null;
  const columnByName = new Map(safeColumns.map((column) => [column.raw_name, column]));
  const cellIssueMap = buildCellIssueMap(safeFindings);
  const activeAnalysis = activeAnalysisKey ? analysisResults[activeAnalysisKey] : null;

  useEffect(() => {
    setHoveredColumnName(safeHeaders[0] || "");
    setAnalysisResults({});
    setAnalysisLoadingKey("");
    setAnalysisError("");
    setActiveAnalysisKey("");
    setActiveAnalysisMeta(null);
    setInsightAnalysisItems([]);
    setInsightPlanError("");
  }, [safeHeaders.join("|"), datasetFile?.name, datasetFile?.lastModified]);

  useEffect(() => {
    let ignore = false;

    async function loadLlmAnalysisPlan() {
      if (!useLlm || !safeHeaders.length || !safeRows.length) {
        setInsightAnalysisItems([]);
        setInsightPlanError(useLlm ? "" : "LLM 분석이 꺼져 있어 분석 항목을 생성하지 않습니다.");
        return;
      }

      setInsightPlanLoading(true);
      setInsightPlanError("");
      try {
        const payload = await requestLlmAnalysisPlan({
          headers: safeHeaders,
          sampleRows: safeRows,
          columns: safeColumns,
          llmModel,
          datasetFile,
        });
        if (!ignore) {
          setInsightAnalysisItems(normalizeLlmInsightItems(payload.items, safeColumns));
        }
      } catch (err) {
        if (!ignore) {
          setInsightAnalysisItems([]);
          setInsightPlanError(err.message || "LLM 분석 항목 생성에 실패했습니다.");
        }
      } finally {
        if (!ignore) setInsightPlanLoading(false);
      }
    }

    loadLlmAnalysisPlan();
    return () => {
      ignore = true;
    };
  }, [useLlm, llmModel, safeHeaders.join("|"), safeRows.length, safeColumns.length, datasetFile?.name, datasetFile?.lastModified]);

  async function handleRunAnalysis(column, method, key) {
    const analysisType = inferAnalysisType(method, column);
    setAnalysisLoadingKey(key);
    setAnalysisError("");
    setActiveAnalysisKey(key);
    setActiveAnalysisMeta({ columnName: column.raw_name, method, analysisType });
    try {
      const { result, meta, warning } = await runColumnAnalysis({
        headers: safeHeaders,
        sampleRows: safeRows,
        column,
        method,
        datasetFile,
        useLlm,
        llmModel,
      });
      setActiveAnalysisMeta(meta);
      setAnalysisResults((prev) => ({
        ...prev,
        [key]: result,
      }));
      setAnalysisError(warning || "");
    } catch (err) {
      setAnalysisError(err.message || "분석 실행 중 오류가 발생했습니다.");
    } finally {
      setAnalysisLoadingKey("");
    }
  }

  if (!safeRows.length) {
    return <div className="empty-state">업로드된 데이터 미리보기를 생성하지 못했습니다.</div>;
  }

  return (
    <div className="preview-layout">
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              <th>행</th>
              {safeHeaders.map((header) => (
                <th
                  key={header}
                  className={hoveredColumnName === header ? "is-column-hovered" : ""}
                  onMouseEnter={() => setHoveredColumnName(header)}
                  title={standardMappingText(columnByName.get(header))}
                >
                  <span className="preview-column-header">
                    <span className="preview-column-name">{header}</span>
                    <StandardMappingBadge column={columnByName.get(header)} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, index) => (
              <tr key={`preview-row-${index}`}>
                <td>{index + 1}</td>
                {safeHeaders.map((header) => (
                  <td
                    key={`${index}-${header}`}
                    className={[
                      hoveredColumnName === header ? "is-column-hovered" : "",
                      cellIssueMap.has(`${index + 1}::${header}`) ? "is-fix-needed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setHoveredColumnName(header)}
                    title={
                      cellIssueMap.has(`${index + 1}::${header}`)
                        ? cellIssueMap
                            .get(`${index + 1}::${header}`)
                            .map(
                              (finding) =>
                                `[${formatFindingType(finding)}] ${formatCriterionName(finding.criterion_name)}: ${finding.message}`,
                            )
                            .join("\n")
                        : undefined
                    }
                  >
                    {displayValue(row[header])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="hover-panel">
        <div className="hover-panel-title">컬럼 상세 정보</div>
        <div className="hover-panel-subtitle">{hoveredColumnName || "-"}</div>
        {!hoveredColumn ? (
          <div className="empty-state">컬럼 프로파일 정보가 없습니다.</div>
        ) : (
          <div className="hover-detail-list">
            <div className="hover-detail-item hover-detail-item-primary">
              <div className="hover-detail-key">컬럼 요약</div>
              <div className="hover-detail-value">
                {buildColumnSummary(hoveredColumn)}
              </div>
            </div>
            <div className="hover-detail-item hover-detail-item-primary">
              <div className="hover-detail-key">값 분포</div>
              <div className="hover-detail-value">
                <ColumnValueDonut column={hoveredColumn} />
              </div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">전체 / 유효값</div>
              <div className="hover-detail-value">
                {formatCount(hoveredColumn.total_count)}건 / {formatCount(hoveredColumn.non_empty_count)}건
              </div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">결측 비율</div>
              <div className="hover-detail-value">{formatPercent(hoveredColumn.null_ratio)}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">고유값 수</div>
              <div className="hover-detail-value">{hoveredColumn.distinct_count ?? "200+"}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">숫자 파싱 비율</div>
              <div className="hover-detail-value">{formatPercent(hoveredColumn.numeric_parse_ratio)}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">날짜 파싱 비율</div>
              <div className="hover-detail-value">{formatPercent(hoveredColumn.date_parse_ratio)}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">의미 프로파일</div>
              <div className="hover-detail-value">{hoveredColumn.semantic_profile_label || "-"}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">설명</div>
              <div className="hover-detail-value">
                {hoveredColumn.semantic_profile_description || "의미 설명이 없습니다."}
              </div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">의미 신뢰도</div>
              <div className="hover-detail-value">{formatConfidence(hoveredColumn.semantic_profile_confidence)}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">LLM 의미 프로파일링</div>
              <div className="hover-detail-value">{hoveredColumn.semantic_profile_llm_needed ? "필요" : "불필요"}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">LLM 필요 사유</div>
              <div className="hover-detail-value">
                {hoveredColumn.semantic_profile_llm_reasons?.join(", ") || "-"}
              </div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">표준용어 후보</div>
              <div className="hover-detail-value">{hoveredColumn.standard_candidates?.[0] || "-"}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">매핑 유형</div>
              <div className="hover-detail-value">{formatMatchType(hoveredColumn.standard_match_type)}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">샘플값</div>
              <div className="hover-detail-value">{hoveredColumn.sample_values?.join(", ") || "-"}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">적용 규칙</div>
              <div className="hover-detail-value">{hoveredColumn.assigned_rules?.join(", ") || "-"}</div>
            </div>
            <div className="hover-detail-item">
              <div className="hover-detail-key">수정 제안</div>
              <div className="hover-detail-value">{hoveredColumn.repair_suggestion || "-"}</div>
            </div>
          </div>
        )}
      </aside>

      <section className="insight-analysis-panel">
        <div className="analysis-canvas-header">
          <div>
            <h2 className="analysis-section-title">추천 데이터 분석</h2>
            <div className="analysis-canvas-subtitle">
              LLM이 업로드 데이터 샘플을 보고 분석 방법, 코드, 시각화 방향을 end-to-end로 생성합니다.
            </div>
          </div>
        </div>
        {insightPlanLoading ? (
          <div className="empty-state">LLM이 데이터 샘플을 보고 분석 항목을 생성하고 있습니다.</div>
        ) : insightAnalysisItems.length ? (
          <ul className="analysis-method-list insight-analysis-list">
            {insightAnalysisItems.map((item) => (
              <li key={item.key}>
                <div className="analysis-method-row">
                  <span>
                    <strong>{item.title || item.column.raw_name}</strong>
                    <span className="analysis-method-type"> · {formatAnalysisType(item.analysisType)}</span>
                    <br />
                    {item.method}
                  </span>
                  <button
                    className="inline-button"
                    type="button"
                    onClick={() => handleRunAnalysis(item.column, item.method, item.key)}
                    disabled={analysisLoadingKey === item.key}
                  >
                    {analysisLoadingKey === item.key ? "실행 중" : "실행"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            {insightPlanError || "LLM이 실행 가능한 도메인 분석 항목을 찾지 못했습니다."}
          </div>
        )}
        {analysisError ? <div className="analysis-error">{analysisError}</div> : null}
      </section>

      <section className="analysis-canvas">
        <div className="analysis-canvas-header">
          <div>
            <h2 className="analysis-section-title">분석 시각화</h2>
            <div className="analysis-canvas-subtitle">
              {activeAnalysisMeta
                ? `${activeAnalysisMeta.columnName} · ${activeAnalysisMeta.title || formatAnalysisType(activeAnalysisMeta.analysisType)}`
                : "추천 데이터 분석을 실행하면 여기에 표시됩니다."}
            </div>
          </div>
        </div>
        {activeAnalysis ? (
          <div className="analysis-canvas-body">
            <div className="analysis-canvas-summary">{displayValue(activeAnalysis.summary)}</div>
            <AnalysisVisualization result={activeAnalysis} />
          </div>
        ) : analysisLoadingKey ? (
          <div className="empty-state">분석을 실행하고 있습니다.</div>
        ) : (
          <div className="empty-state">아직 실행된 분석이 없습니다.</div>
        )}
      </section>
    </div>
  );
}
