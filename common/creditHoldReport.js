import ExcelJS from 'exceljs';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  darkBlue:  '1F3864',
  medBlue:   '2E5FAB',
  lightBlue: 'BDD7EE',
  green:     'E2EFDA',
  greenText: '375623',
  amber:     'FFF2CC',
  amberText: '7F6000',
  red:       'FCE4D6',
  redText:   '843C0C',
  grey:      'F2F2F2',
  greyText:  '595959',
  white:     'FFFFFF',
};

const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } });
const font = (opts = {}) => ({
  name:   'Calibri',
  size:   opts.size   ?? 10,
  bold:   opts.bold   ?? false,
  italic: opts.italic ?? false,
  color:  { argb: 'FF' + (opts.color ?? '000000') },
});
const thinBorder = () => {
  const s = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  return { top: s, left: s, bottom: s, right: s };
};
const al = (h = 'left') => ({ horizontal: h, vertical: 'middle', wrapText: true });

const setRow = (ws, rowNum, values, fillHex, fontOpts = {}, height = 16) => {
  ws.getRow(rowNum).height = height;
  values.forEach((v, i) => {
    const c     = ws.getCell(rowNum, i + 1);
    c.value     = v ?? '';
    c.fill      = fill(fillHex);
    c.font      = font(fontOpts);
    c.alignment = al();
    c.border    = thinBorder();
  });
};

const titleRows = (ws, text, subtitle, colCount) => {
  ws.getRow(1).height = 36;
  ws.mergeCells(1, 1, 1, colCount);
  const c1 = ws.getCell(1, 1);
  c1.value = text; c1.fill = fill(C.darkBlue);
  c1.font = font({ bold: true, color: C.white, size: 13 }); c1.alignment = al('center');

  ws.getRow(2).height = 18;
  ws.mergeCells(2, 1, 2, colCount);
  const c2 = ws.getCell(2, 1);
  c2.value = subtitle; c2.fill = fill(C.medBlue);
  c2.font = font({ color: C.white, size: 9, italic: true }); c2.alignment = al('center');
};

const sectionRow = (ws, rowNum, text, colCount, fillHex = C.medBlue) => {
  ws.getRow(rowNum).height = 20;
  ws.mergeCells(rowNum, 1, rowNum, colCount);
  const c = ws.getCell(rowNum, 1);
  c.value = `  ${text}`; c.fill = fill(fillHex);
  c.font = font({ bold: true, color: C.white }); c.alignment = al('left');
};

const headerRow = (ws, rowNum, headers, fillHex = C.lightBlue) => {
  ws.getRow(rowNum).height = 18;
  headers.forEach((h, i) => {
    const c = ws.getCell(rowNum, i + 1);
    c.value = h; c.fill = fill(fillHex);
    c.font = font({ bold: true, size: 9 }); c.alignment = al('center'); c.border = thinBorder();
  });
};

// ── Shared location columns ───────────────────────────────────────────────────
const LOC_COLS   = ['Account Name', 'SF Account ID', 'Shopify Company', 'Company GID', 'Location Name', 'Location GID', 'Previous Payment Terms', 'Result / Notes'];
const LOC_WIDTHS = [35, 22, 35, 38, 35, 38, 28, 55];

const buildLocationSheet = (wb, sheetName, subtitle, rows, rowFill, tabArgb) => {
  const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: 'FF' + tabArgb } } });
  LOC_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  titleRows(ws, sheetName, subtitle, LOC_COLS.length);
  let r = 3;
  headerRow(ws, r, LOC_COLS);
  r++;

  if (rows.length === 0) {
    ws.getRow(r).height = 20;
    ws.mergeCells(r, 1, r, LOC_COLS.length);
    const c = ws.getCell(r, 1);
    c.value = '  No records in this category.';
    c.fill = fill(C.grey); c.font = font({ italic: true, color: C.greyText, size: 9 }); c.alignment = al();
    return;
  }

  rows.forEach(row => { setRow(ws, r, row, rowFill, { size: 9 }); r++; });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
};

// ── Main report builder — returns ExcelJS Workbook ────────────────────────────
export const buildCreditHoldReport = async (results, runMeta) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Candela Sync API';
  wb.created = new Date();

  const totalAccounts  = results.length;
  const found          = results.filter(r => r.companyFound).length;
  const notFound       = totalAccounts - found;
  const totalLocations = results.reduce((s, r) => s + r.totalLocations, 0);
  const totalUpdated   = results.reduce((s, r) => s + r.updated,        0);
  const totalSkipped   = results.reduce((s, r) => s + r.skipped,        0);
  const totalErrors    = results.reduce((s, r) => s + r.errors,         0);

  // ── Summary ─────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF' + C.medBlue } } });
    [42, 18, 18, 18, 18, 18, 42].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    titleRows(ws, 'Credit Hold Payment Terms Sync — Run Report',
      `Environment: ${runMeta.store}  •  Run at: ${runMeta.runAt}  •  DryRun: ${runMeta.dryRun}`, 7);

    let r = 4;
    sectionRow(ws, r, 'RUN TOTALS', 7);
    r++;
    headerRow(ws, r, ['Metric', 'Count', '', '', '', '', '']);
    r++;

    [
      ['SF accounts queried  (Net_30__c = true  AND  SVMX_Credit_Hold__c = true)', totalAccounts,  C.white],
      ['Shopify companies matched',                                                  found,          C.green],
      ['Shopify companies NOT found  (no externalId match)',                         notFound,       notFound  > 0 ? C.red   : C.grey],
      ['Total locations processed',                                                  totalLocations, C.white],
      ['Locations updated  (payment terms cleared)',                                 totalUpdated,   totalUpdated > 0 ? C.green : C.grey],
      ['Locations skipped  (already no payment terms)',                              totalSkipped,   C.grey],
      ['Location update errors',                                                     totalErrors,    totalErrors  > 0 ? C.red   : C.grey],
    ].forEach(([label, count, hex]) => {
      setRow(ws, r, [label, count, '', '', '', '', ''], hex, { size: 9 }); r++;
    });

    r++;
    sectionRow(ws, r, 'PER-ACCOUNT SUMMARY', 7);
    r++;
    headerRow(ws, r, ['Account Name', 'SF Account ID', 'Shopify Company', 'Locations', 'Updated', 'Skipped', 'Errors / Notes']);
    r++;

    results.forEach(res => {
      const hex = !res.companyFound            ? C.amber
                : res.errors > 0               ? C.red
                : res.updated > 0              ? C.green
                : C.white;
      setRow(ws, r, [
        res.name,
        res.sfId,
        res.companyName ?? 'NOT FOUND',
        res.totalLocations,
        res.updated,
        res.skipped,
        res.accountError ?? '',
      ], hex, { size: 9 });
      r++;
    });
  }

  // ── Success tab ──────────────────────────────────────────────────────────────
  const successRows = [];
  results.forEach(res =>
    res.locationRows.filter(l => l.action === 'UPDATED').forEach(l =>
      successRows.push([res.name, res.sfId, res.companyName, res.companyGid,
        l.locationName, l.locationGid, l.previousTerms, l.result])));
  buildLocationSheet(wb, 'Success',
    `Payment terms cleared successfully  •  Total: ${successRows.length}`,
    successRows, C.green, C.greenText);

  // ── Skipped tab ──────────────────────────────────────────────────────────────
  const skippedRows = [];
  results.forEach(res =>
    res.locationRows.filter(l => l.action === 'SKIPPED').forEach(l =>
      skippedRows.push([res.name, res.sfId, res.companyName, res.companyGid,
        l.locationName, l.locationGid, l.previousTerms, l.result])));
  buildLocationSheet(wb, 'Skipped',
    `Location already had no payment terms — no update needed  •  Total: ${skippedRows.length}`,
    skippedRows, C.grey, C.greyText);

  // ── Failed tab ───────────────────────────────────────────────────────────────
  const failedRows = [];
  results.forEach(res =>
    res.locationRows.filter(l => l.action === 'ERROR').forEach(l =>
      failedRows.push([res.name, res.sfId, res.companyName, res.companyGid,
        l.locationName, l.locationGid, l.previousTerms,
        l.result + (l.errorMessage ? ` | ${l.errorMessage}` : '')])));
  buildLocationSheet(wb, 'Failed',
    `Location update failed (Shopify API / userErrors)  •  Total: ${failedRows.length}`,
    failedRows, C.red, C.redText);

  // ── Not Found tab ─────────────────────────────────────────────────────────────
  const notFoundRows = results
    .filter(r => !r.companyFound)
    .map(r => [r.name, r.sfId, 'NOT FOUND', '', '', '', '',
               r.accountError ?? 'No Shopify company for this externalId']);
  buildLocationSheet(wb, 'Not Found',
    `SF account has no matching Shopify company (externalId not found)  •  Total: ${notFoundRows.length}`,
    notFoundRows, C.amber, C.amberText);

  return wb;
};
