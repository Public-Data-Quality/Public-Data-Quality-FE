import { useState } from "react";
import { FindingTypeBadge, SummaryCard, displayValue } from "./components/common";
import { PreviewPanel } from "./components/PreviewPanel";
import {
  formatCriterionName,
  formatMatchType,
  formatPercent,
  formatRelatedColumns,
  formatRuleId,
  formatSeverity,
} from "./lib/formatters";

function formatBreakdown(breakdown, labelFormatter = (value) => value) {
  return Object.entries(breakdown || {})
    .map(([key, value]) => `${labelFormatter(key)} ${value}`)
    .join(" | ") || "-";
}

function ControlPanel({
  datasetFile,
  setDatasetFile,
  llmModel,
  setLlmModel,
  loading,
  error,
  onSubmit,
}) {
  return (
    <section className="control-panel">
      <form onSubmit={onSubmit}>
        <label>
          CSV / Excel 업로드
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => setDatasetFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          LLM 모델
          <input
            value={llmModel}
            onChange={(event) => setLlmModel(event.target.value)}
            placeholder="예: gpt-4o-mini"
          />
        </label>
        <div className="helper-text">기본값: OpenAI GPT API `gpt-4o-mini`</div>
        <button className="primary-button" type="submit" disabled={loading || !datasetFile}>
          {loading ? "분석 중..." : "분석 실행"}
        </button>
      </form>
      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
}

function SummarySection({ summary }) {
  return (
    <div className="summary-grid">
      <SummaryCard label="데이터셋" value={summary.dataset_name} />
      <SummaryCard label="행 수" value={summary.row_count ?? "-"} />
      <SummaryCard label="컬럼 수" value={summary.column_count} />
      <SummaryCard label="표준용어 매핑 비율" value={formatPercent(summary.standard_term_coverage)} />
      <SummaryCard label="표준용어 매핑 분포" value={formatBreakdown(summary.standard_term_coverage_breakdown, formatMatchType)} />
      <SummaryCard label="수정 제안 수" value={summary.repair_suggestion_count} />
      <SummaryCard label="검증 결과 건수" value={summary.finding_count} />
      <SummaryCard label="수동 검토 수" value={summary.manual_review_count} />
      <SummaryCard label="수동 검토 결과" value={summary.manual_review_finding_count ?? 0} />
      <SummaryCard label="오류/이상 결과" value={summary.issue_finding_count ?? 0} />
      <SummaryCard label="결과 유형 분포" value={formatBreakdown(summary.finding_type_breakdown)} />
      <SummaryCard label="관계/완결성/유효성" value={formatBreakdown(summary.finding_breakdown)} />
    </div>
  );
}

function FindingsTable({ findings }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>판정</th>
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
          {(findings || []).map((finding, index) => (
            <tr
              key={`${finding.column_name}-${index}`}
              className={finding.finding_type === "manual_review" ? "finding-row-manual-review" : "finding-row-issue"}
            >
              <td>
                <FindingTypeBadge finding={finding} />
              </td>
              <td>{displayValue(finding.category_label)}</td>
              <td>{displayValue(formatCriterionName(finding.criterion_name))}</td>
              <td>{displayValue(finding.column_name)}</td>
              <td>{displayValue(formatSeverity(finding.severity))}</td>
              <td>{displayValue(formatRuleId(finding.rule_id))}</td>
              <td>{displayValue(finding.message)}</td>
              <td>{displayValue(formatRelatedColumns(finding))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsPanel({ result, datasetFile, useLlm, llmModel }) {
  if (!result) {
    return (
      <section className="results-panel">
        <div className="empty-state">분석을 실행하면 요약, 검증 결과, 컬럼 상세가 여기에 표시됩니다.</div>
      </section>
    );
  }

  return (
    <section className="results-panel">
      <SummarySection summary={result.summary || {}} />

      <div className="result-section">
        <h2>검증 결과</h2>
        <FindingsTable findings={result.findings} />
      </div>

      <div className="result-section">
        <h2>데이터 미리보기</h2>
        <PreviewPanel
          headers={result.preview_headers || []}
          rows={result.preview_rows || []}
          columns={result.columns || []}
          findings={result.findings || []}
          datasetFile={datasetFile}
          useLlm={useLlm}
          llmModel={llmModel}
        />
      </div>
    </section>
  );
}

function App() {
  const [datasetFile, setDatasetFile] = useState(null);
  const [useLlm] = useState(true);
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
          <h1>LLM 기반 공공데이터 품질 관리 및 분석 자동화 시스템</h1>
        </div>
      </header>

      <main className="content-grid">
        <ControlPanel
          datasetFile={datasetFile}
          setDatasetFile={setDatasetFile}
          llmModel={llmModel}
          setLlmModel={setLlmModel}
          loading={loading}
          error={error}
          onSubmit={handleAnalyze}
        />
        <ResultsPanel result={result} datasetFile={datasetFile} useLlm={useLlm} llmModel={llmModel} />
      </main>

      <footer className="app-footer">
        <img className="footer-logo" src="/image/logo.png" alt="행정안전부 로고" />
        <span className="footer-text">행정안전부 데이터정보화담당관</span>
      </footer>
    </div>
  );
}

export default App;
