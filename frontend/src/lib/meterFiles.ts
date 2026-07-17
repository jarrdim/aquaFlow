export interface MeterEvidenceInput {
  evidenceType:
    | "INSTALLATION_PHOTO"
    | "METER_PHOTO"
    | "CUSTOMER_SIGNATURE"
    | "STATUS_PHOTO"
    | "REPLACEMENT_PHOTO"
    | "DOCUMENT";
  fileName: string;
  contentData: string;
  description?: string;
}

export async function fileToEvidence(
  file: File,
  evidenceType: MeterEvidenceInput["evidenceType"],
): Promise<MeterEvidenceInput> {
  if (file.size > 4 * 1024 * 1024)
    throw new Error(`${file.name} exceeds the 4 MB evidence limit`);
  const contentData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
  return { evidenceType, fileName: file.name, contentData };
}

export function openEvidence(item?: {
  contentData?: string;
  content?: string;
}) {
  const source = item?.contentData ?? item?.content;
  if (source) window.open(source, "_blank", "noopener,noreferrer");
}

export async function exportExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return;
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  const headers = Object.keys(rows[0]);
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 2),
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8F1FB" },
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  const data = await workbook.xlsx.writeBuffer();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

export async function parseMeterWorkbook(
  file: File,
): Promise<Record<string, unknown>[]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]);
    return lines
      .slice(1)
      .map((line) =>
        Object.fromEntries(
          parseCsvLine(line).map((value, index) => [headers[index], value]),
        ),
      );
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return [];
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  const records: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    if (
      values.every(
        (value) => value === null || value === undefined || value === "",
      )
    )
      return;
    records.push(
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          values[index] instanceof Date
            ? (values[index] as Date).toISOString().slice(0, 10)
            : (values[index] ?? ""),
        ]),
      ),
    );
  });
  return records;
}
