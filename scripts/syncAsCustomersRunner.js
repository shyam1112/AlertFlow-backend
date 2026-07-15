/**
 * Runs accounts/sync-as-customers controller logic directly as a script.
 *
 * Usage:
 *   node scripts/syncAsCustomersEntry.js --count 150
 *   node scripts/syncAsCustomersEntry.js --count 50 --offset 100
 *   node scripts/syncAsCustomersEntry.js --account-ids 0015g00000AbCdEAA1,0015g00000XyZwVAA0
 *   node scripts/syncAsCustomersEntry.js --count 10 --delay 0
 *
 * Options:
 *   --count N              Number of accounts to fetch (default: 10)
 *   --offset N             Offset to start from (default: 0)
 *   --account-ids ID,...   Comma-separated Salesforce account IDs to sync
 *   --record-type NAME     Filter by Salesforce record type name
 *   --delay N              ms between each account (default: 500)
 *   --skip-existing        Skip accounts already in Shopify (default: true)
 *   --no-skip-existing     Don't skip existing accounts
 */

import { syncAccountsAsCustomers } from '../api/accounts/accountController';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    count: 10,
    offset: 0,
    accountIds: null,
    recordTypeName: null,
    skipExisting: true,
    delayBetween: 500,
    netTerms: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':            { const v = parseInt(args[++i], 10); opts.count        = isNaN(v) ? 10  : v; } break;
      case '--offset':           { const v = parseInt(args[++i], 10); opts.offset       = isNaN(v) ? 0   : v; } break;
      case '--delay':            { const v = parseInt(args[++i], 10); opts.delayBetween = isNaN(v) ? 500 : v; } break;
      case '--account-ids':      opts.accountIds    = args[++i].split(',').map(s => s.trim()); break;
      case '--record-type':      opts.recordTypeName = args[++i];                               break;
      case '--skip-existing':    opts.skipExisting   = true;                                    break;
      case '--no-skip-existing': opts.skipExisting   = false;                                   break;
      case '--net-terms':        opts.netTerms       = true;                                    break;
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

  await syncAccountsAsCustomers(req, res);
  process.exit(exitCode);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
