export function inferAnalysisType(method, column) {
  const columnText = `${column.raw_name || ""} ${column.normalized_name || ""}`;
  const text = `${method || ""} ${columnText}`;
  const isNameColumn = /명|명칭|이름|시설|기관|경찰서/.test(columnText);
  const isNumericColumn = /숫자|금액|요금|가격|율|비율|거리|면적|폭|너비|길이|높이|대수|개수|수량|건수|정원|좌석수/.test(columnText);
  if (/(관리기관|운영기관|제공기관|소관기관|관할|기관명|경찰서명|기관|대상시설|시설명|명칭|이름|시설).*(위치|지역|주소|소재지|좌표|위도|경도|분포|집중|결합)|(위치|지역|주소|소재지|좌표|위도|경도).*(관리기관|운영기관|제공기관|소관기관|관할|기관명|경찰서명|기관|대상시설|시설명|명칭|이름|시설)/.test(text)) return "organization_location_distribution";
  if (/주소.*위도|주소.*경도|소재지.*위도|소재지.*경도|지역.*좌표|좌표.*지역|위도.*경도/.test(text)) return "address_coordinate_consistency";
  if (/여부.*대수|여부.*건수|여부.*수량|대수.*여부|설치.*규모|규모.*설치|구간별/.test(text)) return "flag_count_consistency";
  if (/시작.*종료|종료.*시작|기간|소요|경과/.test(text)) return "date_order_consistency";
  if (/코드.*명|명.*코드|참조|코드별|명칭별/.test(text)) return "code_name_consistency";
  if (isNameColumn && /숫자|범위|최솟|최댓|평균|대수|개수|수량|건수|폭|너비|규모/.test(method || "")) return "category_numeric_distribution";
  if (isNameColumn && /고유|대표|최빈|상위값|쏠림|집중|분포|반복|비율/.test(text)) return "value_distribution";
  if (/결측|누락|null|NULL|빈값/.test(text)) return "null_ratio";
  if (/날짜|일자|일시|년월|형식|파싱/.test(text)) return "date_format_distribution";
  if (/Y\/N|여부|유무|허용값|boolean/i.test(text)) return "boolean_value_distribution";
  if (/위도|경도|좌표/.test(text)) return "coordinate_range";
  if (isNumericColumn || /숫자\s*파싱|숫자\s*범위|최솟|최댓/.test(text)) return "numeric_range";
  if (/길이|문자열/.test(text)) return "length_distribution";
  if (/비교|모순|동시|함께|존재 여부/.test(text)) return "cross_column_missing";
  if (/고유|대표|최빈|상위값|쏠림|집중|분포|반복/.test(text)) return "value_distribution";
  return "value_distribution";
}
