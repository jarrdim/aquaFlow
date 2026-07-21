import fs from "node:fs";
import path from "node:path";

export function resolveStagingSource(fileName: string, argument?: string) {
  return path.resolve(
    argument ??
      path.join(
        process.cwd(),
        "..",
        "..",
        "aquaflow_migration_package",
        "aquaflow_staging",
        fileName,
      ),
  );
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function csvTable(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required migration file was not found: ${filePath}`);
  }

  const [headers, ...records] = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (!headers) throw new Error(`Migration file is empty: ${filePath}`);

  const index = new Map(headers.map((header, position) => [header.trim(), position]));
  const cell = (record: string[], column: string) => {
    const position = index.get(column);
    if (position === undefined) {
      throw new Error(`Required column "${column}" is missing from ${filePath}`);
    }
    return record[position]?.trim() ?? "";
  };
  return { records, cell };
}

export function optional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function requiredDate(value: string, label: string, dateOnly = false) {
  const trimmed = value.trim();
  const normalized = dateOnly
    ? `${trimmed.slice(0, 10)}T00:00:00.000Z`
    : /(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)
      ? trimmed
      : `${trimmed}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: ${value || "blank"}`);
  }
  return parsed;
}

export function requiredDecimal(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value || "blank"}`);
  }
  return parsed;
}

export function requiredBoolean(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid ${label}: ${value || "blank"}`);
}

export function sameDate(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

export function batches<T>(values: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
