/**
 * Updates custom.salutation, custom.region, custom.speciality metafields
 * on all Shopify customers by pulling data from Salesforce.
 *
 * Usage:
 *   node scripts/updateCustomerMetafieldsEntry.js
 *   node scripts/updateCustomerMetafieldsEntry.js --dry-run
 *   node scripts/updateCustomerMetafieldsEntry.js --delay 100
 *
 * Options:
 *   --delay N     ms between each customer update (default: 0)
 *   --dry-run     Fetch and report what would be updated, but don't write to Shopify
 */

import { updateCustomerMetafields } from '../api/accounts/accountController';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    delay: 0,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--delay':    { const v = parseInt(args[++i], 10); opts.delay = isNaN(v) ? 0 : v; } break;
      case '--dry-run':  opts.dryRun = true;                                                    break;
    }
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

  await updateCustomerMetafields(req, res);
  process.exit(exitCode);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
