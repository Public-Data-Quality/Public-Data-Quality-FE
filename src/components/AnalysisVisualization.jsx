function displayValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "-";
    return value.map(displayValue).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "-";
    return entries.map(([key, nestedValue]) => `${key}: ${displayValue(nestedValue)}`).join(" / ");
  }
  return String(value);
}

function asChartRows(items) {
  if (!Array.isArray(items)) return [];
  const maxCount = Math.max(...items.map((item) => Number(item.count) || 0), 1);
  return items.map((item) => ({
    label: displayValue(item.value),
    value: Number(item.count) || 0,
    ratio: displayValue(item.ratio),
    width: `${Math.max(((Number(item.count) || 0) / maxCount) * 100, 2)}%`,
  }));
}

function BarChart({ rows, valueSuffix = "건" }) {
  if (!rows.length) return null;
  return (
    <div className="mini-chart">
      {rows.map((row) => (
        <div className="mini-chart-row" key={`${row.label}-${row.value}`}>
          <div className="mini-chart-label" title={row.label}>{row.label}</div>
          <div className="mini-chart-track">
            <div className="mini-chart-bar" style={{ width: row.width }} />
          </div>
          <div className="mini-chart-value">
            {row.value.toLocaleString()}{valueSuffix}
            {row.ratio !== undefined && row.ratio !== "-" ? ` · ${typeof row.ratio === "number" ? `${row.ratio}%` : displayValue(row.ratio)}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeGeneratedRows(rows) {
  if (!Array.isArray(rows)) return [];
  const maxValue = Math.max(...rows.map((row) => Number(row.value ?? row.count) || 0), 1);
  return rows.slice(0, 30).map((row) => {
    const value = Number(row.value ?? row.count) || 0;
    return {
      label: displayValue(row.label ?? row.value_label ?? row.name ?? row.category ?? row.value),
      value,
      ratio: displayValue(row.ratio),
      width: `${Math.max((value / maxValue) * 100, 2)}%`,
    };
  });
}

function normalizeValueRows(items) {
  if (!Array.isArray(items)) return [];
  const maxValue = Math.max(...items.map((item) => Number(item.value ?? item.count) || 0), 1);
  return items.map((item) => {
    const value = Number(item.value ?? item.count) || 0;
    return {
      label: displayValue(item.label ?? item.value ?? item.name ?? item.category),
      value,
      ratio: displayValue(item.ratio),
      width: `${Math.max((value / maxValue) * 100, 2)}%`,
    };
  });
}

function rowsFromStatsItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      label: displayValue(item.label ?? item.name),
      value: Number(item.value ?? item.count),
    }))
    .filter((row) => Number.isFinite(row.value));
}

function rowsFromGeneratedTable(columns, rows) {
  if (!Array.isArray(columns) || !Array.isArray(rows) || !rows.length) return [];
  const numericColumn = columns.find((column) =>
    rows.some((row) => Number.isFinite(Number(String(row?.[column] ?? "").replace(/,/g, "")))),
  );
  if (!numericColumn) return [];
  const labelColumn = columns.find((column) => column !== numericColumn) || columns[0];
  return rows.slice(0, 20).map((row) => ({
    label: displayValue(row?.[labelColumn]),
    value: Number(String(row?.[numericColumn] ?? "").replace(/,/g, "")) || 0,
  }));
}

function PlotOrEmpty({ rows, preferred = "bar" }) {
  const normalizedRows = normalizeValueRows(rows).filter((row) => row.value > 0);
  if (!normalizedRows.length) {
    return <div className="empty-state">시각화할 수치형 결과가 없습니다.</div>;
  }
  if (preferred === "donut" && normalizedRows.length <= 8) {
    return <DonutChart rows={normalizedRows} />;
  }
  return <BarChart rows={normalizedRows} valueSuffix="" />;
}

function StatGrid({ items }) {
  const visibleItems = items.filter((item) => item.value !== undefined && item.value !== null && item.value !== "");
  if (!visibleItems.length) return null;
  return (
    <div className="metric-grid">
      {visibleItems.map((item) => (
        <div className="metric-item" key={displayValue(item.label)}>
          <div className="metric-label">{displayValue(item.label)}</div>
          <div className="metric-value">{displayValue(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ rows }) {
  const chartRows = normalizeValueRows(rows).filter((row) => row.value > 0).slice(0, 8);
  const total = chartRows.reduce((sum, row) => sum + row.value, 0);
  if (!chartRows.length || !total) return null;
  let cursor = 0;
  const colors = ["#1f6f5b", "#11284d", "#b16c08", "#8b5cf6", "#0f766e", "#bc2f2b", "#4b5563", "#64748b"];
  const gradient = chartRows
    .map((row, index) => {
      const start = cursor;
      const end = cursor + (row.value / total) * 100;
      cursor = end;
      return `${colors[index % colors.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="donut-panel">
      <div className="donut-chart" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="donut-center">
          <strong>{total.toLocaleString()}</strong>
          <span>전체</span>
        </div>
      </div>
      <div className="donut-legend">
        {chartRows.map((row, index) => (
          <div className="donut-legend-row" key={`${row.label}-${row.value}`}>
            <span className="donut-swatch" style={{ background: colors[index % colors.length] }} />
            <span className="donut-label" title={row.label}>{row.label}</span>
            <span>{Math.round((row.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistogramChart({ rows }) {
  const chartRows = normalizeValueRows(rows);
  if (!chartRows.length) return null;
  const maxValue = Math.max(...chartRows.map((row) => row.value), 1);
  return (
    <div className="histogram-chart">
      {chartRows.map((row) => (
        <div className="histogram-bin" key={`${row.label}-${row.value}`}>
          <div className="histogram-bar-wrap">
            <div className="histogram-bar" style={{ height: `${Math.max((row.value / maxValue) * 100, 4)}%` }} />
          </div>
          <div className="histogram-label" title={row.label}>{row.label}</div>
          <div className="histogram-value">{row.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function LineChart({ rows }) {
  const chartRows = normalizeValueRows(rows).slice(0, 24);
  if (!chartRows.length) return null;
  const maxValue = Math.max(...chartRows.map((row) => row.value), 1);
  const width = 640;
  const height = 220;
  const padX = 28;
  const padY = 24;
  const points = chartRows.map((row, index) => {
    const x = chartRows.length === 1 ? width / 2 : padX + (index / (chartRows.length - 1)) * (width - padX * 2);
    const y = height - padY - (row.value / maxValue) * (height - padY * 2);
    return { ...row, x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");

  return (
    <div className="line-chart-wrap">
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="추세 선 그래프">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} />
        <line x1={padX} y1={padY} x2={padX} y2={height - padY} />
        <path d={path} />
        {points.map((point) => (
          <circle key={`${point.label}-${point.value}`} cx={point.x} cy={point.y} r="4">
            <title>{`${point.label}: ${point.value.toLocaleString()}`}</title>
          </circle>
        ))}
      </svg>
      <div className="line-chart-axis">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function Heatmap({ rows }) {
  const tableRows = Array.isArray(rows) ? rows.slice(0, 12) : [];
  if (!tableRows.length) return null;
  const allRegions = Array.from(
    new Set(tableRows.flatMap((row) => (row.top_regions || []).map((region) => displayValue(region.value)))),
  ).slice(0, 8);
  const maxValue = Math.max(
    ...tableRows.flatMap((row) => (row.top_regions || []).map((region) => Number(region.count) || 0)),
    1,
  );
  return (
    <div className="heatmap-wrap">
      <table className="heatmap-table">
        <thead>
          <tr>
            <th>구분</th>
            {allRegions.map((region) => <th key={region}>{displayValue(region)}</th>)}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row) => (
            <tr key={displayValue(row.organization || row.label)}>
              <th>{displayValue(row.organization || row.label)}</th>
              {allRegions.map((region) => {
                const match = (row.top_regions || []).find((item) => displayValue(item.value) === region);
                const value = Number(match?.count) || 0;
                const opacity = value ? Math.max(value / maxValue, 0.12) : 0;
                return (
                  <td key={`${displayValue(row.organization || row.label)}-${region}`} style={{ background: `rgba(31, 111, 91, ${opacity})` }}>
                    {value || ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeneratedTable({ columns, rows }) {
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows) || !rows.length) return null;
  return (
    <div className="generated-table-wrap">
      <table className="generated-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={displayValue(column)}>{displayValue(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((row, index) => (
            <tr key={`generated-row-${index}`}>
              {columns.map((column) => (
                <td key={`${index}-${displayValue(column)}`}>{displayValue(row?.[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeneratedScatter({ points, xLabel, yLabel }) {
  const numericPoints = (Array.isArray(points) ? points : [])
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
      label: point.label || "",
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 1500);
  if (!numericPoints.length) return <div className="empty-state">시각화할 좌표형 값이 없습니다.</div>;
  const minX = Math.min(...numericPoints.map((point) => point.x));
  const maxX = Math.max(...numericPoints.map((point) => point.x));
  const minY = Math.min(...numericPoints.map((point) => point.y));
  const maxY = Math.max(...numericPoints.map((point) => point.y));
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;
  return (
    <div className="scatter-panel">
      <div className="scatter-plot" aria-label="LLM 생성 산점도">
        {numericPoints.map((point, index) => (
          <span
            className="scatter-point"
            key={`${point.x}-${point.y}-${index}`}
            style={{ left: `${((point.x - minX) / xSpan) * 100}%`, top: `${100 - ((point.y - minY) / ySpan) * 100}%` }}
            title={`${point.label || "점"}: ${xLabel || "x"} ${point.x}, ${yLabel || "y"} ${point.y}`}
          />
        ))}
      </div>
      <div className="scatter-axis">
        <span>{displayValue(xLabel || "x")} {minX}</span>
        <span>{displayValue(xLabel || "x")} {maxX}</span>
      </div>
      <div className="scatter-note">{displayValue(yLabel || "y")} 범위 {minY} ~ {maxY}</div>
    </div>
  );
}

function GeneratedVisualization({ spec }) {
  if (!spec || typeof spec !== "object") return null;
  if (spec.type === "combo" && Array.isArray(spec.charts)) {
    return (
      <div className="analysis-viz analysis-viz-generated-combo">
        {spec.charts.slice(0, 4).map((chart, index) => (
          <GeneratedVisualization key={`${chart?.title || chart?.type || "chart"}-${index}`} spec={chart} />
        ))}
      </div>
    );
  }
  const title = spec.title ? <div className="analysis-result-label">{displayValue(spec.title)}</div> : null;
  if (spec.type === "bar" || spec.type === "horizontal_bar") {
    return (
      <div className="generated-viz-section">
        {title}
        <BarChart rows={normalizeGeneratedRows(spec.rows)} valueSuffix={spec.value_suffix ?? ""} />
      </div>
    );
  }
  if (spec.type === "donut" || spec.type === "pie") {
    return (
      <div className="generated-viz-section">
        {title}
        <DonutChart rows={normalizeGeneratedRows(spec.rows)} />
      </div>
    );
  }
  if (spec.type === "histogram") {
    return (
      <div className="generated-viz-section">
        {title}
        <HistogramChart rows={normalizeGeneratedRows(spec.rows || spec.bins)} />
      </div>
    );
  }
  if (spec.type === "line") {
    return (
      <div className="generated-viz-section">
        {title}
        <LineChart rows={normalizeGeneratedRows(spec.rows)} />
      </div>
    );
  }
  if (spec.type === "heatmap") {
    return (
      <div className="generated-viz-section">
        {title}
        <PlotOrEmpty rows={rowsFromGeneratedTable(spec.columns, spec.rows)} />
        <GeneratedTable columns={spec.columns} rows={spec.rows} />
      </div>
    );
  }
  if (spec.type === "scatter") {
    return (
      <div className="generated-viz-section">
        {title}
        <GeneratedScatter points={spec.points} xLabel={spec.x_label} yLabel={spec.y_label} />
      </div>
    );
  }
  if (spec.type === "table") {
    return (
      <div className="generated-viz-section">
        {title}
        <PlotOrEmpty rows={rowsFromGeneratedTable(spec.columns, spec.rows)} />
        <GeneratedTable columns={spec.columns} rows={spec.rows} />
      </div>
    );
  }
  if (spec.type === "stats") {
    const statRows = rowsFromStatsItems(spec.items);
    return (
      <div className="generated-viz-section">
        {title}
        <PlotOrEmpty rows={statRows} />
        <StatGrid items={Array.isArray(spec.items) ? spec.items : []} />
      </div>
    );
  }
  return null;
}

function CoordinateScatter({ points, latitudeRange, longitudeRange }) {
  if (!Array.isArray(points) || !points.length) {
    return <div className="empty-state">시각화할 유효 좌표가 없습니다.</div>;
  }
  const [minLat, maxLat] = latitudeRange || [];
  const [minLon, maxLon] = longitudeRange || [];
  const latSpan = maxLat - minLat || 1;
  const lonSpan = maxLon - minLon || 1;
  const renderedPoints = points.slice(0, 1500);

  return (
    <div className="scatter-panel">
      <div className="scatter-plot" aria-label="위도 경도 산점도">
        {renderedPoints.map((point, index) => {
          const x = ((point.longitude - minLon) / lonSpan) * 100;
          const y = 100 - ((point.latitude - minLat) / latSpan) * 100;
          return (
            <span
              className="scatter-point"
              key={`${point.latitude}-${point.longitude}-${index}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${point.region}: 위도 ${point.latitude}, 경도 ${point.longitude}`}
            />
          );
        })}
      </div>
      <div className="scatter-axis">
        <span>경도 {minLon}</span>
        <span>경도 {maxLon}</span>
      </div>
      <div className="scatter-note">
        유효 좌표 {points.length.toLocaleString()}건을 경도(x축), 위도(y축) 기준으로 표시합니다.
        {points.length > renderedPoints.length ? ` 화면 성능을 위해 ${renderedPoints.length.toLocaleString()}건만 렌더링했습니다.` : ""}
      </div>
    </div>
  );
}

export function AnalysisVisualization({ result }) {
  const metrics = result?.metrics || {};
  const type = result?.analysisType;
  const dynamicTopEntry = Object.entries(metrics).find(
    ([key, value]) =>
      key.startsWith("top_") &&
      Array.isArray(value) &&
      value.some((item) => item && typeof item === "object" && "value" in item && "count" in item),
  );
  const dynamicDistributionEntry = Object.entries(metrics).find(
    ([key, value]) =>
      key.endsWith("_distribution") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );

  if (type === "llm_generated" && result?.visualization) {
    return <GeneratedVisualization spec={result.visualization} />;
  }

  if (type === "address_coordinate_consistency") {
    return (
      <div className="analysis-viz analysis-viz-geo">
        <CoordinateScatter
          points={metrics.coordinate_points}
          latitudeRange={metrics.latitude_range}
          longitudeRange={metrics.longitude_range}
        />
        <div className="geo-side">
          <StatGrid
            items={[
              { label: "좌표 행", value: metrics.coordinate_count?.toLocaleString?.() ?? metrics.coordinate_count },
              { label: "좌표 이상값", value: metrics.invalid_coordinate_count?.toLocaleString?.() ?? metrics.invalid_coordinate_count },
              { label: "평균 위도", value: metrics.avg_latitude },
              { label: "평균 경도", value: metrics.avg_longitude },
              { label: "위도 범위", value: metrics.latitude_range?.length ? metrics.latitude_range.join(" ~ ") : "" },
              { label: "경도 범위", value: metrics.longitude_range?.length ? metrics.longitude_range.join(" ~ ") : "" },
            ]}
          />
          <div className="geo-region-chart">
            <div className="analysis-result-label">지역 분포</div>
            <BarChart rows={asChartRows(metrics.top_regions)} />
          </div>
        </div>
      </div>
    );
  }

  if (type === "organization_location_distribution") {
    return (
      <div className="analysis-viz analysis-viz-org-location">
        <div className="org-location-section">
          <div className="analysis-result-label">기관별 분포</div>
          <BarChart rows={asChartRows(metrics.top_organizations)} />
        </div>
        <div className="org-location-section">
          <div className="analysis-result-label">기관-지역 조합</div>
          <BarChart rows={asChartRows(metrics.top_org_region_pairs)} />
        </div>
        <div className="org-location-section">
          <div className="analysis-result-label">지역별 분포</div>
          <BarChart rows={asChartRows(metrics.top_regions)} />
        </div>
        <div className="org-location-section org-location-heatmap">
          <div className="analysis-result-label">기관-지역 히트맵</div>
          <Heatmap rows={metrics.organization_region_matrix} />
        </div>
        <StatGrid
          items={[
            { label: "분석 행", value: metrics.usable_row_count?.toLocaleString?.() ?? metrics.usable_row_count },
            { label: "기관 수", value: metrics.organization_count?.toLocaleString?.() ?? metrics.organization_count },
            { label: "지역 수", value: metrics.region_count?.toLocaleString?.() ?? metrics.region_count },
            { label: "좌표 행", value: metrics.coordinate_count?.toLocaleString?.() ?? metrics.coordinate_count },
            { label: "기관 컬럼", value: metrics.organization_column },
            { label: "위치 컬럼", value: metrics.address_column || [metrics.latitude_column, metrics.longitude_column].filter(Boolean).join(", ") },
          ]}
        />
      </div>
    );
  }

  if (type === "category_numeric_distribution") {
    const numericSummaryRows = (metrics.category_numeric_summary || []).slice(0, 20).map((row) => ({
      "항목": row.value,
      "행 수": row.count,
      "합계": row.total,
      "평균": row.avg,
      "최솟값": row.min,
      "최댓값": row.max,
    }));
    return (
      <div className="analysis-viz">
        <div>
          <div className="analysis-result-label">{displayValue(metrics.category_column || "항목")}별 행 수</div>
          <BarChart rows={asChartRows(metrics.top_categories)} />
        </div>
        <div>
          <div className="analysis-result-label">{displayValue(metrics.numeric_column || "수치")} 요약</div>
          <PlotOrEmpty rows={rowsFromGeneratedTable(["항목", "행 수", "합계", "평균", "최솟값", "최댓값"], numericSummaryRows)} />
          <GeneratedTable columns={["항목", "행 수", "합계", "평균", "최솟값", "최댓값"]} rows={numericSummaryRows} />
          <StatGrid
            items={[
              { label: "명칭 컬럼", value: metrics.category_column },
              { label: "숫자 컬럼", value: metrics.numeric_column },
              { label: "명칭 수", value: metrics.category_count?.toLocaleString?.() ?? metrics.category_count },
              { label: "파싱 실패", value: metrics.parse_failed_count?.toLocaleString?.() ?? metrics.parse_failed_count },
            ]}
          />
        </div>
      </div>
    );
  }

  if (type === "code_name_consistency") {
    const mappingRows = Object.entries(metrics.code_to_name_count || {})
      .slice(0, 20)
      .map(([code, count]) => ({
        "코드": code,
        "연결 명칭 수": count,
      }));
    return (
      <div className="analysis-viz analysis-viz-code-name">
        <div>
          <div className="analysis-result-label">코드별 건수</div>
          <BarChart rows={asChartRows(metrics.top_codes)} />
        </div>
        <div>
          <div className="analysis-result-label">명칭별 건수</div>
          <BarChart rows={asChartRows(metrics.top_names)} />
        </div>
        <div className="generated-viz-section">
          <div className="analysis-result-label">코드-명칭 연결</div>
          <PlotOrEmpty rows={rowsFromGeneratedTable(["코드", "연결 명칭 수"], mappingRows)} />
          <GeneratedTable columns={["코드", "연결 명칭 수"]} rows={mappingRows} />
        </div>
      </div>
    );
  }

  if (type === "flag_count_consistency" && metrics.groups) {
    const groupRows = Object.entries(metrics.groups).map(([label, group]) => ({
      label,
      value: Number(group.total) || 0,
      ratio: group.rows ? `${group.rows}행` : undefined,
    }));
    const maxValue = Math.max(...groupRows.map((row) => row.value), 1);
    return (
      <div className="analysis-viz">
        <div>
          <div className="analysis-result-label">상태별 합계</div>
          <BarChart rows={groupRows.map((row) => ({ ...row, width: `${Math.max((row.value / maxValue) * 100, 2)}%` }))} valueSuffix="" />
        </div>
        <StatGrid
          items={Object.entries(metrics.groups).map(([label, group]) => ({
            label: `${label} 평균`,
            value: group.avg,
          }))}
        />
      </div>
    );
  }

  if (type === "numeric_range") {
    return (
      <div className="analysis-viz analysis-viz-numeric">
        <div>
          <div className="analysis-result-label">숫자 분포</div>
          <HistogramChart rows={metrics.histogram_bins} />
        </div>
        <StatGrid
          items={[
            { label: "숫자값", value: metrics.numeric_count?.toLocaleString?.() ?? metrics.numeric_count },
            { label: "파싱 실패", value: metrics.failed_count?.toLocaleString?.() ?? metrics.failed_count },
            { label: "최솟값", value: metrics.min },
            { label: "최댓값", value: metrics.max },
            { label: "평균", value: metrics.avg },
          ]}
        />
      </div>
    );
  }

  if (type === "date_order_consistency" && metrics.year_pairs) {
    const rows = Object.entries(metrics.year_pairs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label, value }));
    return (
      <div className="analysis-viz">
        <div>
          <div className="analysis-result-label">연도 구간 추세</div>
          <LineChart rows={rows} />
        </div>
        <StatGrid
          items={[
            { label: "시작 컬럼", value: metrics.start_column },
            { label: "종료 컬럼", value: metrics.end_column },
            { label: "기간 쌍", value: metrics.paired_count?.toLocaleString?.() ?? metrics.paired_count },
            { label: "같은 월 종료", value: metrics.same_month_count?.toLocaleString?.() ?? metrics.same_month_count },
          ]}
        />
      </div>
    );
  }

  if (type === "date_format_distribution" && metrics.format_distribution) {
    const rows = Object.entries(metrics.format_distribution).map(([label, value]) => ({ label, value }));
    return (
      <div className="analysis-viz">
        <DonutChart rows={rows} />
        <StatGrid items={[{ label: "기타 형식", value: metrics.other_count }]} />
      </div>
    );
  }

  if ((type === "value_distribution" || type === "boolean_value_distribution") && (metrics.top_values || metrics.value_distribution)) {
    const rows = metrics.top_values || Object.entries(metrics.value_distribution).map(([label, value]) => ({ label, value }));
    return (
      <div className="analysis-viz">
        <DonutChart rows={rows} />
        <BarChart rows={normalizeValueRows(rows)} />
      </div>
    );
  }

  if (metrics.top_values || metrics.top_codes || metrics.top_names || dynamicTopEntry) {
    return (
      <div className="analysis-viz">
        <BarChart rows={asChartRows(metrics.top_values || metrics.top_codes || metrics.top_names || dynamicTopEntry?.[1])} />
      </div>
    );
  }

  if (metrics.format_distribution || metrics.value_distribution || dynamicDistributionEntry) {
    const distribution = metrics.format_distribution || metrics.value_distribution || dynamicDistributionEntry?.[1];
    const rows = Object.entries(distribution).map(([label, value]) => ({ label, value: Number(value) || 0 }));
    const maxValue = Math.max(...rows.map((row) => row.value), 1);
    return (
      <div className="analysis-viz">
        <BarChart rows={rows.map((row) => ({ ...row, width: `${Math.max((row.value / maxValue) * 100, 2)}%` }))} />
      </div>
    );
  }

  const scalarItems = Object.entries(metrics)
    .filter(([, value]) => typeof value === "number" || typeof value === "string")
    .map(([label, value]) => ({ label, value }));
  const scalarRows = rowsFromStatsItems(scalarItems);
  return (
    <div className="analysis-viz">
      <PlotOrEmpty rows={scalarRows} />
      <StatGrid items={scalarItems} />
    </div>
  );
}
