/**
 * Credit Hold Payment Terms Sync — CLI Runner
 *
 * Queries Salesforce for accounts where Net_30__c = true AND SVMX_Credit_Hold__c = true,
 * finds each account's Shopify company by externalId, fetches all locations,
 * and clears payment terms on any location that still has them.
 *
 * Decision logic:
 *   net30=true AND creditHold=true  →  targetAction = "clear"  (remove payment terms from all locations)
 *
 * Usage:
 *   NODE_ENV=local node scripts/creditHoldSyncEntry.js
 *   NODE_ENV=local node scripts/creditHoldSyncEntry.js --dry-run
 *
 * Options:
 *   --dry-run    Simulate — query SF + Shopify but do NOT write to Shopify
 *
 * Output:
 *   Excel report saved to reports/ with 5 tabs:
 *     Summary | Success | Skipped | Failed | Not Found
 */

import path from 'path';
import fs from 'fs';
import { runCreditHoldSync } from '../common/creditHoldSyncService';
import { buildCreditHoldReport } from '../common/creditHoldReport';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// ── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  const runAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

  console.log('='.repeat(60));
  console.log('Credit Hold Payment Terms Sync');
  console.log(`Store   : ${process.env.STORE_URL}`);
  console.log(`SF user : ${process.env.SALESFORCE_USERNAME}`);
  console.log(`DryRun  : ${dryRun}`);
  console.log(`Run at  : ${runAt}`);
  console.log('='.repeat(60));

  const results = await runCreditHoldSync(dryRun);

  // ── Console summary ───────────────────────────────────────────────────────
  const totalUpdated  = results.reduce((s, r) => s + r.updated,  0);
  const totalSkipped  = results.reduce((s, r) => s + r.skipped,  0);
  const totalErrors   = results.reduce((s, r) => s + r.errors,   0);
  const totalLocations = results.reduce((s, r) => s + r.totalLocations, 0);
  const notFound      = results.filter(r => !r.companyFound).length;

  console.log('\n' + '='.repeat(60));
  console.log('SYNC COMPLETE');
  console.log(`  Accounts   : ${results.length}`);
  console.log(`  Not found  : ${notFound}`);
  console.log(`  Locations  : ${totalLocations}`);
  console.log(`  Updated    : ${totalUpdated}`);
  console.log(`  Skipped    : ${totalSkipped}`);
  console.log(`  Errors     : ${totalErrors}`);
  console.log('='.repeat(60));

  // ── Save Excel report ─────────────────────────────────────────────────────
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const ts       = runAt.replace(/[: ]/g, '-');
  const filename = `credit_hold_sync_${ts}.xlsx`;
  const filepath = path.join(reportsDir, filename);

  const runMeta = { store: process.env.STORE_URL, runAt, dryRun };
  const wb      = await buildCreditHoldReport(results, runMeta);
  await wb.xlsx.writeFile(filepath);

  console.log(`\n📄 Report saved: ${filepath}`);
};

main().catch(err => {
  console.error('creditHoldSyncRunner failed:', err);
  process.exit(1);
});
