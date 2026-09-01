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

export async function exportMeterReadingZoneWorkbook(
  filename: string,
  importRows: Record<string, unknown>[],
  zoneSheets: MeterReadingZoneSheet[],
) {
  if (!importRows.length || !zoneSheets.length) return;
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Samdamte Water";
  workbook.company = "Samdamte Water";
  workbook.subject = "Meter reading sheets by zone";
  workbook.created = new Date();

  const usedNames = new Set<string>();
  zoneSheets.forEach((group) => {
    const sheet = workbook.addWorksheet(
      safeWorksheetName(group.zoneName, usedNames),
      {
        pageSetup: {
          orientation: "portrait",
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
        views: [{ state: "frozen", ySplit: 7 }],
      },
    );
    sheet.properties.defaultRowHeight = 19;
    sheet.pageSetup.printTitlesRow = "1:7";
    sheet.headerFooter.oddFooter =
      "&LSamdamte Water - Meter Reading Sheet&CPage &P of &N&RGenerated &D";

    sheet.columns = [
      { key: "Serial Number", width: 10 },
      { key: "Account Number", width: 18 },
      { key: "Customer Names", width: 30 },
      { key: "Previous Reading", width: 16 },
      { key: "Meter Reading", width: 16 },
      { key: "Comment", width: 24 },
    ];

    sheet.mergeCells("A1:F2");
    const title = sheet.getCell("A1");
    title.value = `SAMDAMTE WATER\nREADING SHEETS FOR ${group.readingCycle.toUpperCase()}`;
    title.font = { bold: true, size: 18 };
    title.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(1).height = 25;
    sheet.getRow(2).height = 25;

    const details = [
      ["AREA / ZONE", [group.zoneName, ...group.areaNames].filter(Boolean).join(" / ")],
      ["DATE OF READING", group.readingDate],
      ["PERSON READING", group.readerNames.length ? group.readerNames.join(", ") : ""],
    ];
    details.forEach(([label, value], index) => {
      const rowNumber = 3 + index;
      const startColumn = 1;
      const labelEnd = 2;
      const valueStart = 3;
      const valueEnd = 6;
      sheet.mergeCells(rowNumber, startColumn, rowNumber, labelEnd);
      sheet.mergeCells(rowNumber, valueStart, rowNumber, valueEnd);
      const labelCell = sheet.getCell(rowNumber, startColumn);
      labelCell.value = label;
      labelCell.font = { bold: true, size: 9 };
      labelCell.alignment = { horizontal: "center", vertical: "middle" };
      const valueCell = sheet.getCell(rowNumber, valueStart);
      valueCell.value = value;
      valueCell.font = { bold: true, size: 10 };
      valueCell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });

    const headerRow = sheet.getRow(7);
    headerRow.values = sheet.columns.map((column) => column.key);
    headerRow.height = 28;
    headerRow.font = { bold: true, size: 9 };
    headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    group.rows.forEach((row, index) => {
      const excelRow = sheet.addRow({ "Serial Number": index + 1, ...row });
      excelRow.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      excelRow.getCell(3).alignment = {
        horizontal: "left",
        vertical: "middle",
        wrapText: true,
      };
      excelRow.getCell(5).alignment = {
        horizontal: "right",
        vertical: "middle",
        wrapText: true,
      };
      excelRow.height = 13;
      if ((index + 1) % 48 === 0 && index + 1 < group.rows.length) {
        excelRow.addPageBreak();
      }
    });
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < 7) return;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFBFBFBF" } },
          left: { style: "thin", color: { argb: "FFBFBFBF" } },
          bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
          right: { style: "thin", color: { argb: "FFBFBFBF" } },
        };
      });
    });
    sheet.autoFilter = { from: "A7", to: "F7" };
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

export async function exportMeterReadingZonePdf(
  filename: string,
  zoneSheets: MeterReadingZoneSheet[],
  _logoUrl = "/samdamte-water-logo-print.png",
  printedBy = "Signed-in user",
) {
  if (!zoneSheets.length) return;
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Samdamte Water Meter Reading Sheets");
  pdf.setAuthor("Samdamte Water");
  pdf.setSubject("Meter reading worklist by zone");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 portrait gives the 48-record field sheet a larger on-screen type size.
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const tableWidth = pageWidth - margin * 2;
  const columns: Array<{
    label: string;
    key: string;
    width: number;
    align?: "left" | "center" | "right";
  }> = [
    { label: "NO.", key: "Serial Number", width: 35, align: "center" },
    { label: "ACCOUNT NO.", key: "Account Number", width: 82 },
    { label: "CUSTOMER NAMES", key: "Customer Names", width: 155, align: "left" },
    { label: "PREVIOUS", key: "Previous Reading", width: 74, align: "right" },
    { label: "METER READING", key: "Meter Reading", width: 82, align: "right" },
    { label: "COMMENT", key: "Comment", width: tableWidth - 428 },
  ];
  const text = (value: unknown) => String(value ?? "");
  const fit = (value: unknown, width: number, size: number, font = regular) => {
    const source = text(value);
    if (font.widthOfTextAtSize(source, size) <= width) return source;
    let result = source;
    while (result.length && font.widthOfTextAtSize(`${result}...`, size) > width)
      result = result.slice(0, -1);
    return result ? `${result}...` : "";
  };

  for (const group of zoneSheets) {
    const rowsPerPage = 48;
    const chunks = Array.from(
      { length: Math.max(1, Math.ceil(group.rows.length / rowsPerPage)) },
      (_, index) => group.rows.slice(index * rowsPerPage, (index + 1) * rowsPerPage),
    );
    chunks.forEach((rows, chunkIndex) => {
      const page = pdf.addPage([pageWidth, pageHeight]);
      const ink = rgb(0, 0, 0);
      const muted = rgb(0.3, 0.3, 0.3);
      const border = rgb(0.65, 0.65, 0.65);
      const paper = rgb(1, 1, 1);
      const brandTitle = "SAMDAMTE WATER";
      page.drawText(brandTitle, {
        x: (pageWidth - bold.widthOfTextAtSize(brandTitle, 16)) / 2,
        y: pageHeight - 82,
        size: 14,
        font: bold,
        color: ink,
      });
      const title = `READING SHEETS FOR ${group.readingCycle.toUpperCase()}`;
      const fittedTitle = fit(title, 500, 12, bold);
      page.drawText(fittedTitle, {
        x: (pageWidth - bold.widthOfTextAtSize(fittedTitle, 12)) / 2,
        y: pageHeight - 99,
        size: 12,
        font: bold,
        color: ink,
      });
      page.drawText(`Zone sheet ${chunkIndex + 1} of ${chunks.length}`, {
        x: pageWidth - margin - 100,
        y: pageHeight - 33,
        size: 8,
        font: regular,
        color: muted,
      });

      const area = [group.zoneName, ...group.areaNames].filter(Boolean).join(" / ");
      const reader = group.readerNames.length ? group.readerNames.join(", ") : "";
      const meta = [
        ["AREA / ZONE", area],
        ["METER READER", reader],
        ["READING DATE", group.readingDate],
      ];
      const metaY = pageHeight - 142;
      const metaWidth = tableWidth / 3;
      meta.forEach(([label, value], index) => {
        const x = margin + index * metaWidth;
        page.drawRectangle({ x, y: metaY, width: metaWidth - 8, height: 34, color: paper, borderColor: border, borderWidth: 0.6 });
        const fittedLabel = fit(label, metaWidth - 24, 7, bold);
        const fittedValue = fit(value, metaWidth - 24, 9, bold);
        page.drawText(fittedLabel, {
          x: x + (metaWidth - 8 - bold.widthOfTextAtSize(fittedLabel, 7)) / 2,
          y: metaY + 21,
          size: 7,
          font: bold,
          color: muted,
        });
        page.drawText(fittedValue, {
          x: x + (metaWidth - 8 - bold.widthOfTextAtSize(fittedValue, 9)) / 2,
          y: metaY + 8,
          size: 9,
          font: bold,
          color: ink,
        });
      });

      const headerY = metaY - 31;
      const headerHeight = 22;
      const rowHeight = 13;
      let x = margin;
      columns.forEach((column) => {
        page.drawRectangle({ x, y: headerY, width: column.width, height: headerHeight, color: paper, borderColor: ink, borderWidth: 0.6 });
        const label = fit(column.label, column.width - 6, 7.3, bold);
        const labelWidth = bold.widthOfTextAtSize(label, 7.3);
        page.drawText(label, { x: x + Math.max(3, (column.width - labelWidth) / 2), y: headerY + 7.2, size: 7.3, font: bold, color: ink });
        x += column.width;
      });

      rows.forEach((row, rowIndex) => {
        const y = headerY - (rowIndex + 1) * rowHeight;
        x = margin;
        const serialNumber = chunkIndex * rowsPerPage + rowIndex + 1;
        columns.forEach((column, columnIndex) => {
          page.drawRectangle({ x, y, width: column.width, height: rowHeight, color: paper, borderColor: border, borderWidth: 0.5 });
          const value = columnIndex === 0 ? serialNumber : row[column.key];
          const rendered = fit(value, column.width - 8, 8);
          const valueWidth = regular.widthOfTextAtSize(rendered, 8);
          const textX = column.align === "left"
            ? x + 4
            : column.align === "right"
              ? x + column.width - valueWidth - 4
              : x + Math.max(4, (column.width - valueWidth) / 2);
          page.drawText(rendered, { x: textX, y: y + 2.9, size: 8, font: regular, color: ink });
          x += column.width;
        });
      });
    });
  }

  const pages = pdf.getPages();
  const printedAt = new Date().toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  pages.forEach((page, index) => {
    const footer = `Printed by: ${printedBy}  |  Printed date and time: ${printedAt}  |  Page ${index + 1} of ${pages.length}`;
    page.drawText(fit(footer, pageWidth - margin * 2, 7), {
      x: margin,
      y: 16,
      size: 7,
      font: regular,
      color: rgb(0.38, 0.46, 0.56),
    });
  });
  const bytes = await pdf.save();
  const pdfBytes = new Uint8Array(bytes.byteLength);
  pdfBytes.set(bytes);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([pdfBytes], { type: "application/pdf" }),
  );
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
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
  requiredHeaders: string[] = [],
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
  const records: Record<string, unknown>[] = [];
  const normalizeHeader = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const supportedHeaderSets = [
    ["Account Number", "Meter Reading"],
    ["meterNumber", "meterType"],
    ["meterNumber", "accountNumber", "assignmentDate"],
    ["propertyCode", "customerNumber", "serviceAreaCode"],
    ["accountNumber", "customerNumber", "propertyCode"],
    ["accountNumber", "openingBalance", "currentBalance"],
    ["meterNumber", "accountNumber", "cycleCode", "previousReading", "currentReading"],
    ["accountNumber", "transactionReference", "amount", "paymentDate"],
  ];
  const acceptedHeaderSets = (requiredHeaders.length
    ? [requiredHeaders]
    : supportedHeaderSets
  ).map((headers) => headers.map(normalizeHeader));
  workbook.worksheets.forEach((sheet) => {
    if (sheet.rowCount < 2) return;
    let headerRowNumber = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber++) {
      const candidate = (sheet.getRow(rowNumber).values as unknown[])
        .slice(1)
        .map(normalizeHeader);
      if (
        acceptedHeaderSets.some((headers) =>
          headers.every((header) => candidate.includes(header)),
        )
      ) {
        headerRowNumber = rowNumber;
        break;
      }
    }
    if (!headerRowNumber) return;
    const headers = (sheet.getRow(headerRowNumber).values as unknown[])
      .slice(1)
      .map(String);
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
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
  });
  return records;
}
