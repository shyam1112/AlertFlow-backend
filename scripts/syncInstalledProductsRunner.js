/**
 * Runs accounts/sync-installed-products controller logic directly as a script.
 *
 * Usage:
 *   node scripts/syncInstalledProductsEntry.js
 *   node scripts/syncInstalledProductsEntry.js --contact-ids ID1,ID2
 *   node scripts/syncInstalledProductsEntry.js --delay 500
 *
 * Options:
 *   --contact-ids ID,...   Comma-separated Salesforce contact IDs (finds customers by tag)
 *                          If omitted, processes ALL Shopify customers
 *   --delay N              ms between each customer update (default: 300)
 */

import { syncInstalledProductsToCustomers } from '../api/accounts/accountController';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    contactIds: null,
    delayBetween: 300,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--contact-ids': opts.contactIds  = args[++i].split(',').map(s => s.trim()); break;
      case '--delay':       { const v = parseInt(args[++i], 10); opts.delayBetween = isNaN(v) ? 300 : v; } break;
    }
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const { contactIds, delayBetween } = parseArgs();

  const body = { delayBetween };
  if (contactIds) body.contactIds = contactIds;

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

  await syncInstalledProductsToCustomers(req, res);
  process.exit(exitCode);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
