import { useState } from "react";

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

function SummaryCard({ label, value }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value}</div>
    </div>
  );
}

function formatPercent(value) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatTopValues(topValues) {
  if (!topValues?.length) return "-";
  return topValues.map(([value, count]) => `${value} (${count})`).join(", ");
}

function formatMatchType(value) {
  const labels = {
    exact: "정확 일치",
    synonym: "동의어 일치",
    partial: "부분 일치",
    rule_only: "규칙 기반",
    rag_resolved: "RAG 보정",
    llm_resolved: "LLM 보정",
    unmatched: "미매핑",
  };
  return labels[value] || "-";
}

function formatCriterionName(value) {
  const labels = {
    categorical_semantic_domain: "범주 의미 일관성",
  };
  return labels[value] || value || "-";
}

function formatRuleId(value) {
  const labels = {
    categorical_value_normalization: "범주값 표준화 필요",
    categorical_value_out_of_domain: "도메인 외 값 의심",
    categorical_value_manual_review: "범주값 수동 검토",
  };
  return labels[value] || value || "-";
}

function formatRelatedColumns(finding) {
  if (finding.related_columns?.length) {
    return finding.related_columns.join(", ");
  }
  return finding.column_name || "-";
}

function buildColumnSummary(column) {
  const profile = column.semantic_profile_label || "의미 미분류";
  const type = column.inferred_primitive_type || "타입 미확정";
  const standard = column.standard_candidates?.[0];
  const nullRatio = formatPercent(column.null_ratio);
  const distinct = column.distinct_count ?? "200+";
  const topValues = formatTopValues(column.top_values);

  const sentences = [
    `${column.raw_name} 컬럼은 ${profile} 성격의 ${type} 데이터로 해석됩니다.`,
    column.semantic_profile_description || "의미 설명은 아직 충분히 생성되지 않았습니다.",
    `결측 비율은 ${nullRatio}이고, 확인된 고유값 수는 ${distinct}개입니다.`,
  ];

  if (topValues !== "-") {
    sentences.push(`대표값은 ${topValues}입니다.`);
  }
  if (standard) {
    sentences.push(`가장 유력한 표준용어 후보는 '${standard}'입니다.`);
  }
  if (column.standard_match_type) {
    sentences.push(`표준용어 매핑 유형은 ${formatMatchType(column.standard_match_type)}입니다.`);
  }
  if (column.semantic_profile_llm_needed) {
    sentences.push(`의미 프로파일링에 LLM 보조가 필요하다고 판단했습니다.`);
  }
  if (column.repair_suggestion) {
    sentences.push(`권장 조치는 ${column.repair_suggestion}입니다.`);
  }

  return sentences.join(" ");
}

function ColumnCard({ column }) {
  const recommendedStandard = column.standard_candidates?.[0];
  const showRecommendation = recommendedStandard && recommendedStandard !== column.raw_name;

  return (
    <article className="column-card" key={`${column.source}-${column.raw_name}`}>
      {showRecommendation ? (
        <div className="column-recommendation">
          추천 표준용어: <strong>{recommendedStandard}</strong>
        </div>
      ) : null}
      <div className="column-head">
        <div>
          <div className="column-title">{column.raw_name}</div>
        </div>
        <span className="column-source">{column.source === "response" ? "응답 컬럼" : "요청 컬럼"}</span>
      </div>
      <p className="column-narrative">{buildColumnSummary(column)}</p>
    </article>
  );
}

function PreviewPanel({ headers, rows, columns, findings }) {
  const [hoveredColumnName, setHoveredColumnName] = useState(headers?.[0] || "");
  const hoveredColumn = columns.find((column) => column.raw_name === hoveredColumnName) || null;
  const cellIssueMap = buildCellIssueMap(findings);

  if (!rows?.length) {
    return <div className="empty-state">업로드된 데이터 미리보기를 생성하지 못했습니다.</div>;
  }

  return (
    <div className="preview-layout">
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              <th>row</th>
              {headers.map((header) => (
                <th
                  key={header}
                  className={hoveredColumnName === header ? "is-column-hovered" : ""}
                  onMouseEnter={() => setHoveredColumnName(header)}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`preview-row-${index}`}>
                <td>{index + 1}</td>
                {headers.map((header) => (
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
                            .map((finding) => `${formatCriterionName(finding.criterion_name)}: ${finding.message}`)
                            .join("\n")
                        : undefined
                    }
                  >
                    {row[header] || "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="hover-panel">
        <div className="hover-panel-title">Column Hover Detail</div>
        <div className="hover-panel-subtitle">{hoveredColumnName || "-"}</div>
        {!hoveredColumn ? (
          <div className="empty-state">컬럼 프로파일 정보가 없습니다.</div>
        ) : (
          <div className="hover-detail-list">
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
              <div className="hover-detail-key">추정 타입</div>
              <div className="hover-detail-value">{hoveredColumn.inferred_primitive_type || "-"}</div>
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
              <div className="hover-detail-key">대표값</div>
              <div className="hover-detail-value">{formatTopValues(hoveredColumn.top_values)}</div>
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
    </div>
  );
}

function App() {
  const [datasetFile, setDatasetFile] = useState(null);
  const [useLlm, setUseLlm] = useState(false);
  const [llmModel, setLlmModel] = useState("gpt-4o-mini");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAnalyze(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!datasetFile) {
        throw new Error("분석할 CSV 파일을 먼저 업로드하세요.");
      }

      const body = new FormData();
      if (datasetFile) body.append("dataset_file", datasetFile);
      body.append("use_llm_agents", String(useLlm));
      if (llmModel) body.append("llm_model", llmModel);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "분석 요청에 실패했습니다.");
      }
      setResult(payload);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <h1>멀티 에이전트 기반 공공데이터 품질 진단 및 개선 모델</h1>
          <p className="hero-note">
            일반 LLM 기반 semantic profiling을 넘어서 공공데이터 도메인에 특화된 멀티 에이전트 기반
            데이터 이해-진단-수정-검증 파이프라인을 제안합니다.
          </p>
        </div>
      </header>

      <main className="content-grid">
        <section className="control-panel">
          <form onSubmit={handleAnalyze}>
            <label>
              CSV / Excel 업로드
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setDatasetFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
              LLM agent 사용
            </label>
            <label>
              LLM 모델
              <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} disabled={!useLlm} />
            </label>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "분석 중..." : "분석 실행"}
            </button>
          </form>
          {error ? <div className="error-box">{error}</div> : null}
        </section>

        <section className="results-panel">
          {!result ? (
            <div className="empty-state">분석을 실행하면 요약, findings, 컬럼 상세가 여기에 표시됩니다.</div>
          ) : (
            <>
              <div className="summary-grid">
                <SummaryCard label="데이터셋" value={result.summary.dataset_name} />
                <SummaryCard label="행 수" value={result.summary.row_count ?? "-"} />
                <SummaryCard label="컬럼 수" value={result.summary.column_count} />
                <SummaryCard label="표준용어 매핑 비율" value={formatPercent(result.summary.standard_term_coverage)} />
                <SummaryCard
                  label="표준용어 매핑 분포"
                  value={Object.entries(result.summary.standard_term_coverage_breakdown || {})
                    .map(([key, value]) => `${formatMatchType(key)} ${value}`)
                    .join(" | ") || "-"}
                />
                <SummaryCard label="수정 제안 수" value={result.summary.repair_suggestion_count} />
                <SummaryCard label="검증 결과 건수" value={result.summary.finding_count} />
                <SummaryCard label="수동 검토 수" value={result.summary.manual_review_count} />
                <SummaryCard
                  label="관계/완결성/유효성"
                  value={Object.entries(result.summary.finding_breakdown || {})
                    .map(([key, value]) => `${key} ${value}`)
                    .join(" | ") || "-"}
                />
              </div>

              <div className="result-section">
                <h2>Findings</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>검증영역</th>
                        <th>기준명</th>
                        <th>컬럼</th>
                        <th>심각도</th>
                        <th>규칙</th>
                        <th>메시지</th>
                        <th>관련 컬럼</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.findings.map((finding, index) => (
                        <tr key={`${finding.column_name}-${index}`}>
                          <td>{finding.category_label}</td>
                          <td>{formatCriterionName(finding.criterion_name)}</td>
                          <td>{finding.column_name}</td>
                          <td>{finding.severity}</td>
                          <td>{formatRuleId(finding.rule_id)}</td>
                          <td>{finding.message}</td>
                          <td>{formatRelatedColumns(finding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="result-section">
                <h2>Data Preview</h2>
                <PreviewPanel
                  headers={result.preview_headers}
                  rows={result.preview_rows}
                  columns={result.columns}
                  findings={result.findings}
                />
              </div>

              <div className="result-section">
                <h2>Columns</h2>
                <div className="column-list">
                  {result.columns.map((column) => (
                    <ColumnCard column={column} key={`${column.source}-${column.raw_name}`} />
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <img className="footer-logo" src="/image/logo.png" alt="행정안전부 로고" />
        <span className="footer-text">행정안전부 데이터정보화담당관 청년인턴</span>
      </footer>
    </div>
  );
}

export default App;
