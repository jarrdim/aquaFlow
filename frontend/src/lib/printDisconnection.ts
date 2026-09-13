type Account = Record<string, any>;

const escape = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const amount = (value: unknown) => Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A separate document keeps application styles and named pages out of the print job. */
export async function printDisconnection(zones: [string, Account[]][], rule: string) {
  const rowsPerPage = 40;
  const printedAt = new Date().toLocaleDateString("en-KE", { dateStyle: "medium" });
  const logo = new URL("/samdamte-water-logo-print.png", window.location.href).href;
  const sheets = zones.flatMap(([zone, accounts]) => {
    const sheetCount = Math.ceil(accounts.length / rowsPerPage);
    return Array.from({ length: sheetCount }, (_, index) => ({
      zone, accounts, sheet: index + 1, sheetCount,
      offset: index * rowsPerPage,
      rows: accounts.slice(index * rowsPerPage, (index + 1) * rowsPerPage),
    }));
  });
  if (!sheets.length) return;
  const pages = sheets.map((sheet, pageIndex) => {
    const rows = sheet.rows.map((row, index) => `<tr>
      <td class="center">${sheet.offset + index + 1}</td>
      <td>${escape(row.accountNumber)}</td>
      <td>${escape(row.customerName)}</td>
      <td class="number">${amount(row.currentBalance)}</td>
    </tr>`).join("");
    const blanks = Array.from({ length: rowsPerPage - sheet.rows.length }, () => `<tr>${"<td>&nbsp;</td>".repeat(4)}</tr>`).join("");
    return `<section class="sheet">
      <div class="sheet-number">Zone sheet ${sheet.sheet} of ${sheet.sheetCount}</div>
      <header><img src="${escape(logo)}" alt="Samdamte Water" /><div><h1>SAMDAMTE WATER</h1><h2>DISCONNECTION ELIGIBLE ACCOUNTS</h2></div></header>
      <div class="details"><div><label>AREA / ZONE</label><strong>${escape(sheet.zone)}</strong></div><div><label>ELIGIBILITY RULE</label><strong>${escape(rule)}</strong></div><div><label>PRINT DATE</label><strong>${escape(printedAt)}</strong></div></div>
      <table><colgroup><col style="width:9%"><col style="width:23%"><col style="width:48%"><col style="width:20%"></colgroup>
      <thead><tr><th>SERIAL</th><th>ACCOUNT</th><th>CUSTOMER</th><th>BALANCE (KSh)</th></tr></thead>
      <tbody>${rows}${blanks}</tbody></table>
      <footer><span>${sheet.accounts.length} accounts in zone · Account balance: KSh ${amount(sheet.accounts.reduce((sum, row) => sum + Number(row.currentBalance ?? 0), 0))}</span><span>Page ${pageIndex + 1} of ${sheets.length}</span></footer>
    </section>`;
  }).join("");
  const frame = document.createElement("iframe");
  frame.title = "Disconnection print document";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0";
  const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Disconnection list</title><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: #111; font-family: Arial, Helvetica, sans-serif; }
    .sheet { width: 210mm; height: 297mm; padding: 10mm; break-after: page; overflow: hidden; }
    .sheet:last-child { break-after: auto; }
    .sheet-number { height: 5mm; text-align: right; font-size: 9pt; }
    header { height: 20mm; position: relative; display: flex; align-items: center; justify-content: center; text-align: center; }
    header img { position: absolute; left: 0; width: 28mm; height: 16mm; object-fit: contain; }
    h1 { margin: 0 0 1.5mm; font-size: 16pt; }
    h2 { margin: 0; font-size: 11pt; }
    .details { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin: 2mm 0 4mm; }
    .details > div { height: 14mm; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1mm 2mm; text-align: center; }
    label { font-size: 8pt; margin-bottom: 1.5mm; }
    strong { font-size: 10pt; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; border: .45mm solid #555; }
    th, td { border: 0; border-right: .4mm solid #777; border-bottom: .4mm solid #777; }
    th:last-child, td:last-child { border-right: 0; }
    tbody tr:last-child td { border-bottom: 0; }
    th { height: 9mm; font-size: 8pt; font-weight: 700; text-align: center; padding: 1mm; }
    td { height: 5.2mm; padding: .5mm 2mm; font-size: 9.5pt; line-height: 1; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .number { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    footer { display: flex; justify-content: space-between; border-top: 1px solid #555; padding-top: 2mm; margin-top: 3mm; font-size: 8pt; }
  </style></head><body>${pages}</body></html>`;
  document.body.appendChild(frame);
  try {
    await loaded;
    const printWindow = frame.contentWindow;
    if (!printWindow) throw new Error("Unable to open the print document.");
    await Promise.all(Array.from(printWindow.document.images).map((img) => img.decode().catch(() => undefined)));
    printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}
