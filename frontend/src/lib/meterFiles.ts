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

export interface MeterReadingZoneSheet {
  zoneName: string;
  areaNames: string[];
  readingCycle: string;
  readingDate: string;
  readerNames: string[];
  rows: Record<string, unknown>[];
}

function safeWorksheetName(name: string, usedNames: Set<string>) {
  const base = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim() || "Unassigned zone";
  let candidate = base.slice(0, 31);
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const marker = ` (${suffix++})`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function imageAsDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load logo (${response.status})`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the logo"));
    reader.readAsDataURL(blob);
  });
}

export async function exportMeterReadingZoneWorkbook(
  filename: string,
  importRows: Record<string, unknown>[],
  zoneSheets: MeterReadingZoneSheet[],
  logoUrl = "/samdamte-water-logo-print.png",
) {
  if (!importRows.length) return;
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Samdamte Water";
  workbook.company = "Samdamte Water";
  workbook.subject = "Meter reading sheets by zone";
  workbook.created = new Date();

  // Keep the import-compatible worklist first: the bulk upload reads the first
  // worksheet and expects its field names on row one.
  const importSheet = workbook.addWorksheet("Reading Worklist", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const importHeaders = Object.keys(importRows[0]);
  importSheet.columns = importHeaders.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 2),
  }));
  importRows.forEach((row) => importSheet.addRow(row));
  importSheet.getRow(1).height = 24;
  importSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  importSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF075985" },
  };
  importSheet.getRow(1).alignment = { vertical: "middle" };
  importSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: importHeaders.length },
  };

  let logoId: number | undefined;
  try {
    const logo = await imageAsDataUrl(logoUrl);
    logoId = workbook.addImage({ base64: logo, extension: "png" });
  } catch {
    // The workbook is still useful if a deployment has not copied the logo asset.
  }

  const usedNames = new Set(["reading worklist"]);
  zoneSheets.forEach((group) => {
    const sheet = workbook.addWorksheet(
      safeWorksheetName(group.zoneName, usedNames),
      {
        pageSetup: {
          orientation: "landscape",
          paperSize: 9,
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: {
            left: 0.25,
            right: 0.25,
            top: 0.35,
            bottom: 0.35,
            header: 0.15,
            footer: 0.15,
          },
        },
        views: [{ state: "frozen", ySplit: 8 }],
      },
    );
    sheet.properties.defaultRowHeight = 19;
    sheet.pageSetup.printTitlesRow = "1:8";
    sheet.headerFooter.oddFooter =
      "&LSamdamte Water - Meter Reading Sheet&CPage &P of &N&RGenerated &D";

    sheet.columns = [
      { key: "No.", width: 6 },
      { key: "Meter ID", width: 11 },
      { key: "Meter Number", width: 18 },
      { key: "Account Number", width: 18 },
      { key: "Customer Number", width: 18 },
      { key: "Customer Name", width: 27 },
      { key: "Area", width: 20 },
      { key: "Route", width: 20 },
      { key: "Previous Reading", width: 17 },
      { key: "Current Reading", width: 17 },
      { key: "Reading Date", width: 15 },
      { key: "Person Reading", width: 22 },
      { key: "Remarks", width: 24 },
      { key: "Status", width: 13 },
    ];

    sheet.mergeCells("A1:N2");
    const title = sheet.getCell("A1");
    title.value = "SAMDAMTE WATER\nMETER READING SHEET";
    title.font = { bold: true, size: 18, color: { argb: "FF0B3A6E" } };
    title.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(1).height = 31;
    sheet.getRow(2).height = 31;
    if (logoId !== undefined) {
      sheet.addImage(logoId, {
        tl: { col: 0.25, row: 0.15 },
        ext: { width: 72, height: 72 },
      });
    }

    const details = [
      ["AREA / ZONE", [group.zoneName, ...group.areaNames].filter(Boolean).join(" / ")],
      ["READING CYCLE", group.readingCycle],
      ["DATE OF READING", group.readingDate],
      ["PERSON READING", group.readerNames.length ? group.readerNames.join(", ") : "Not assigned"],
    ];
    details.forEach(([label, value], index) => {
      const rowNumber = 3 + Math.floor(index / 2) * 2;
      const startColumn = index % 2 === 0 ? 1 : 8;
      const labelEnd = startColumn + 1;
      const valueStart = startColumn + 2;
      const valueEnd = startColumn + 6;
      sheet.mergeCells(rowNumber, startColumn, rowNumber, labelEnd);
      sheet.mergeCells(rowNumber, valueStart, rowNumber, valueEnd);
      const labelCell = sheet.getCell(rowNumber, startColumn);
      labelCell.value = label;
      labelCell.font = { bold: true, size: 9, color: { argb: "FF64748B" } };
      const valueCell = sheet.getCell(rowNumber, valueStart);
      valueCell.value = value;
      valueCell.font = { bold: true, size: 10, color: { argb: "FF0F172A" } };
      valueCell.alignment = { wrapText: true };
    });

    const headerRow = sheet.getRow(8);
    headerRow.values = sheet.columns.map((column) => column.key);
    headerRow.height = 28;
    headerRow.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF075985" },
    };
    headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    group.rows.forEach((row, index) => {
      const excelRow = sheet.addRow({ "No.": index + 1, ...row });
      excelRow.alignment = { vertical: "middle", wrapText: true };
      excelRow.height = 25;
      if (index % 2 === 1) {
        excelRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF4F9FC" },
        };
      }
    });
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < 8) return;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD6E3EE" } },
          left: { style: "thin", color: { argb: "FFD6E3EE" } },
          bottom: { style: "thin", color: { argb: "FFD6E3EE" } },
          right: { style: "thin", color: { argb: "FFD6E3EE" } },
        };
      });
    });
    sheet.autoFilter = { from: "A8", to: "N8" };
  });

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
