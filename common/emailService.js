import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import logger from './logger';

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    logger.warn('EMAIL_USER or EMAIL_PASS not set — skipping email');
    return;
  }
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"AlertFlow" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    attachments,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEADER_FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const BORDER = { style: 'thin', color: { argb: 'FFD1D5DB' } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

function styleHeader(row, argb) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL(argb);
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = ALL_BORDERS;
  });
  row.height = 22;
}

function styleDataRow(row, isEven) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL(isEven ? 'FFF9FAFB' : 'FFFFFFFF');
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = ALL_BORDERS;
  });
}

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-IN', { timeZone: 'UTC' }) + ' UTC';
}

// Group violations by rule name, sorted by count desc
function groupByRule(violations) {
  const map = {};
  for (const v of violations) {
    const key = v.rule_name || 'Unknown Rule';
    if (!map[key]) map[key] = { rule_name: key, resource_type: v.resource_type || '—', violations: [] };
    map[key].violations.push(v);
  }
  return Object.values(map).sort((a, b) => b.violations.length - a.violations.length);
}

// Safe sheet name: max 31 chars, no invalid chars
function safeSheetName(name) {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
}

// ── Excel report generator ────────────────────────────────────────────────────

async function generateScanReport({
  shopName, scanned_at, products_scanned,
  violations_found, violations_resolved, duration_ms,
  active_violations, resolved_violations,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AlertFlow';
  wb.created = new Date();

  const ruleGroups = groupByRule(active_violations);

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summarySheet = wb.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 36 },
  ];
  styleHeader(summarySheet.getRow(1), 'FF1D4ED8');

  const summaryRows = [
    ['Store', shopName],
    ['Scan Date', fmt(scanned_at)],
    ['Products Scanned', products_scanned],
    ['New Violations Found', violations_found],
    ['Violations Auto-Resolved', violations_resolved],
    ['Total Active Violations', active_violations.length],
    ['Rules With Violations', ruleGroups.length],
    ['Scan Duration', `${(duration_ms / 1000).toFixed(1)}s`],
  ];
  summaryRows.forEach((r, i) => {
    const row = summarySheet.addRow({ field: r[0], value: r[1] });
    styleDataRow(row, i % 2 === 0);
  });

  // Spacer
  summarySheet.addRow({});

  // Per-rule breakdown in Summary sheet
  const breakdownHeader = summarySheet.addRow({ field: 'Rule', value: 'Products Failing' });
  styleHeader(breakdownHeader, 'FFDC2626');
  ruleGroups.forEach((g, i) => {
    const row = summarySheet.addRow({ field: g.rule_name, value: g.violations.length });
    styleDataRow(row, i % 2 === 0);
  });

  if (ruleGroups.length === 0) {
    const row = summarySheet.addRow({ field: 'No active violations — store is clean!', value: '' });
    styleDataRow(row, false);
  }

  // ── One sheet per rule ────────────────────────────────────────────────────
  // Each sheet lists ALL products/variants currently failing that rule
  const RULE_COLORS = [
    'FFDC2626', 'FFEA580C', 'FFD97706', 'FF059669',
    'FF2563EB', 'FF7C3AED', 'FFDB2777', 'FF0891B2',
  ];

  ruleGroups.forEach((group, gi) => {
    const sheetColor = RULE_COLORS[gi % RULE_COLORS.length];
    const sheetName = safeSheetName(`${gi + 1}. ${group.rule_name}`);
    const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: sheetColor } } });

    ws.columns = [
      { header: '#', key: 'num', width: 6 },
      { header: 'Product / Variant', key: 'product', width: 36 },
      { header: 'Current Value', key: 'value', width: 24 },
      { header: 'Issue', key: 'reason', width: 44 },
      { header: 'First Detected', key: 'first', width: 26 },
      { header: 'Last Detected', key: 'last', width: 26 },
    ];
    styleHeader(ws.getRow(1), sheetColor);

    // Rule meta row
    const metaRow = ws.addRow({
      num: 'Rule:',
      product: group.rule_name,
      value: `Type: ${group.resource_type}`,
      reason: `${group.violations.length} product${group.violations.length !== 1 ? 's' : ''} failing`,
      first: '',
      last: '',
    });
    metaRow.eachCell(cell => {
      cell.fill = HEADER_FILL('FFFFF7ED');
      cell.font = { bold: false, italic: true, color: { argb: 'FF92400E' } };
      cell.border = ALL_BORDERS;
    });

    group.violations.forEach((v, i) => {
      const row = ws.addRow({
        num: i + 1,
        product: v.product_title || '—',
        value: v.current_value || '(empty)',
        reason: v.reason || '—',
        first: fmt(v.first_detected_at),
        last: fmt(v.last_detected_at),
      });
      styleDataRow(row, i % 2 === 0);
    });
  });

  // ── Resolved This Scan ────────────────────────────────────────────────────
  if (resolved_violations.length > 0) {
    const resolvedSheet = wb.addWorksheet('Resolved This Scan', {
      properties: { tabColor: { argb: 'FF059669' } },
    });
    resolvedSheet.columns = [
      { header: 'Product / Variant', key: 'product', width: 36 },
      { header: 'Rule', key: 'rule', width: 28 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Resolved At', key: 'resolved', width: 26 },
    ];
    styleHeader(resolvedSheet.getRow(1), 'FF059669');
    resolved_violations.forEach((v, i) => {
      const row = resolvedSheet.addRow({
        product: v.product_title || '—',
        rule: v.rule_name || '—',
        type: v.resource_type || '—',
        resolved: fmt(v.resolved_at || new Date()),
      });
      styleDataRow(row, i % 2 === 0);
    });
  }

  return wb.xlsx.writeBuffer();
}

// ── Email HTML builder ────────────────────────────────────────────────────────

function buildViolationsByRuleHtml(ruleGroups) {
  if (ruleGroups.length === 0) {
    return `<p style="color:#059669;font-weight:600;margin:16px 0;">&#10003; No active violations — your store is clean!</p>`;
  }

  return ruleGroups.map(group => {
    const rows = group.violations.slice(0, 8).map(v =>
      `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;">${v.product_title || '—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280;">${v.current_value || '(empty)'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${v.reason || '—'}</td>
      </tr>`
    ).join('');

    const more = group.violations.length > 8
      ? `<tr><td colspan="3" style="padding:5px 8px;color:#6b7280;font-style:italic;">…and ${group.violations.length - 8} more in the Excel report</td></tr>`
      : '';

    return `
      <div style="margin-bottom:20px;">
        <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;margin-bottom:8px;border-radius:0 4px 4px 0;">
          <span style="font-weight:600;color:#991b1b;">${group.rule_name}</span>
          <span style="margin-left:8px;background:#dc2626;color:#fff;font-size:11px;padding:2px 7px;border-radius:10px;">${group.violations.length} ${group.resource_type}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:5px 8px;text-align:left;color:#6b7280;font-weight:500;">Product</th>
            <th style="padding:5px 8px;text-align:left;color:#6b7280;font-weight:500;">Value</th>
            <th style="padding:5px 8px;text-align:left;color:#6b7280;font-weight:500;">Issue</th>
          </tr></thead>
          <tbody>${rows}${more}</tbody>
        </table>
      </div>`;
  }).join('');
}

// ── Email senders ─────────────────────────────────────────────────────────────

export async function sendViolationAlert(toEmail, violation) {
  const detected = new Date(violation.first_detected_at).toLocaleString('en-IN', { timeZone: 'UTC' });

  await sendEmail({
    to: toEmail,
    subject: `AlertFlow Alert: ${violation.rule_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:#dc2626;padding:16px 24px;">
          <h1 style="color:#fff;margin:0;font-size:20px;">&#x26A0; AlertFlow Violation</h1>
        </div>
        <div style="padding:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Rule</td><td style="padding:8px 0;font-weight:600;">${violation.rule_name}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Product</td><td style="padding:8px 0;">${violation.product_title}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Issue</td><td style="padding:8px 0;">${violation.reason}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Current Value</td><td style="padding:8px 0;">${violation.current_value || '(empty)'}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Detected</td><td style="padding:8px 0;">${detected} UTC</td></tr>
          </table>
          <p style="margin-top:24px;font-size:13px;color:#9ca3af;">Sent by AlertFlow &mdash; Shopify Store Monitoring</p>
        </div>
      </div>
    `,
  });

  logger.info(`Violation alert sent to ${toEmail} for rule "${violation.rule_name}" on "${violation.product_title}"`);
}

export async function sendScanSummaryEmail(toEmail, data) {
  const {
    shopName, scanned_at, products_scanned, violations_found,
    violations_resolved, duration_ms, active_violations,
    resolved_violations = [],
  } = data;

  const durationSec = (duration_ms / 1000).toFixed(1);
  const ruleGroups = groupByRule(active_violations);
  const totalActive = active_violations.length;
  const scanDate = fmt(scanned_at);

  const violationsHtml = buildViolationsByRuleHtml(ruleGroups);

  // Generate Excel report
  const reportBuffer = await generateScanReport({
    shopName, scanned_at, products_scanned, violations_found,
    violations_resolved, duration_ms, active_violations,
    resolved_violations,
  });

  const dateStamp = new Date(scanned_at).toISOString().slice(0, 10);
  const fileName = `alertflow-scan-report-${dateStamp}.xlsx`;
  const sheetCount = ruleGroups.length + (resolved_violations.length > 0 ? 2 : 1); // summary + per-rule + resolved

  await sendEmail({
    to: toEmail,
    subject: `AlertFlow Scan Complete — ${totalActive} active violation${totalActive !== 1 ? 's' : ''} across ${ruleGroups.length} rule${ruleGroups.length !== 1 ? 's' : ''}`,
    html: `
      <div style="font-family:sans-serif;max-width:620px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:#059669;padding:16px 24px;">
          <h1 style="color:#fff;margin:0;font-size:20px;">&#10003; AlertFlow Scan Complete</h1>
          <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">${scanDate}</p>
        </div>
        <div style="padding:24px;">

          <!-- Stats -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Products Scanned</td>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">${products_scanned}</td>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Rules Checked</td>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">${ruleGroups.length + (violations_resolved > 0 ? violations_resolved : 0)}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Active Violations</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:${totalActive > 0 ? '#dc2626' : '#059669'};">${totalActive}</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Auto-Resolved</td>
              <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:#059669;">${violations_resolved}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">New This Scan</td>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;color:${violations_found > 0 ? '#ea580c' : '#059669'};">${violations_found}</td>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Duration</td>
              <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">${durationSec}s</td>
            </tr>
          </table>

          <!-- Violations by rule -->
          <h2 style="font-size:15px;margin:0 0 12px;color:#111827;">Violations by Rule</h2>
          ${violationsHtml}

          <!-- Attachment note -->
          <div style="margin-top:20px;padding:12px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
            <p style="margin:0;font-size:13px;color:#065f46;">
              &#128196; Full report attached: <strong>${fileName}</strong><br>
              ${sheetCount} sheets — Summary with rule breakdown${ruleGroups.length > 0 ? `, then one sheet per rule (${ruleGroups.map(g => g.rule_name).join(', ')})` : ''}${resolved_violations.length > 0 ? ', Resolved This Scan' : ''}
            </p>
          </div>

          <p style="margin-top:20px;font-size:13px;color:#9ca3af;">Sent by AlertFlow &mdash; Shopify Store Monitoring</p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: fileName,
        content: Buffer.from(reportBuffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });

  logger.info(`Scan summary email sent to ${toEmail}: ${products_scanned} products, ${totalActive} active across ${ruleGroups.length} rules`);
}

export async function sendDailyDigest(toEmail, shopName, activeViolations) {
  if (activeViolations.length === 0) return;

  const ruleGroups = groupByRule(activeViolations);

  const ruleRows = ruleGroups
    .map(g => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">${g.rule_name}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:center;">${g.resource_type}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">${g.violations.length}</td>
    </tr>`)
    .join('');

  await sendEmail({
    to: toEmail,
    subject: `AlertFlow Daily Digest — ${activeViolations.length} active violation${activeViolations.length !== 1 ? 's' : ''} across ${ruleGroups.length} rule${ruleGroups.length !== 1 ? 's' : ''}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:#1d4ed8;padding:16px 24px;">
          <h1 style="color:#fff;margin:0;font-size:20px;">AlertFlow Daily Digest</h1>
          <p style="color:#bfdbfe;margin:4px 0 0;">${shopName}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;">You have <strong>${activeViolations.length}</strong> active violation${activeViolations.length !== 1 ? 's' : ''} across <strong>${ruleGroups.length}</strong> rule${ruleGroups.length !== 1 ? 's' : ''}.</p>
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px 0;text-align:left;color:#6b7280;font-weight:500;">Rule</th>
                <th style="padding:8px 0;text-align:center;color:#6b7280;font-weight:500;">Type</th>
                <th style="padding:8px 0;text-align:right;color:#6b7280;font-weight:500;">Products Failing</th>
              </tr>
            </thead>
            <tbody>${ruleRows}</tbody>
          </table>
          <p style="margin-top:24px;font-size:13px;color:#9ca3af;">Sent by AlertFlow &mdash; Shopify Store Monitoring</p>
        </div>
      </div>
    `,
  });

  logger.info(`Daily digest sent to ${toEmail} for ${shopName}: ${activeViolations.length} violations across ${ruleGroups.length} rules`);
}
