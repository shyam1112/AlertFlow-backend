/**
 * Syncs SVMX_Operating_Unit__c from Salesforce accounts → salesforce.primary_operating_unit
 * metafield on Shopify customers.
 *
 * Usage:
 *   node scripts/syncOperatingUnitEntry.js
 *   node scripts/syncOperatingUnitEntry.js --dry-run
 *
 * Options:
 *   --dry-run   Fetch and report what would be updated, but don't write to Shopify
 */

import { syncOperatingUnitMetafield } from '../api/accounts/accountController';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = { dryRun: false };

  for (const arg of args) {
    if (arg === '--dry-run') opts.dryRun = true;
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const body = parseArgs();

  const req = { body };
  let exitCode = 0;

  const res = {
    status: (code) => ({
      json: (data) => {
        if (code >= 400) {
          console.error(`\n❌ Error ${code}:`, JSON.stringify(data, null, 2));
          exitCode = 1;
        } else {
          console.log(`\n✅ Done (${code}):`, JSON.stringify(data, null, 2));
        }
      },
    }),
  };

  await syncOperatingUnitMetafield(req, res);
  process.exit(exitCode);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
