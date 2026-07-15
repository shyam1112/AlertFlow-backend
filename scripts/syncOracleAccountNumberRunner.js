/**
 * Fetches Oracle Cloud Account Number from Salesforce for each customer's linked
 * Salesforce Account, then writes it to the salesforce.oracle_cloud_account_number
 * metafield on the Shopify customer.
 *
 * Usage:
 *   NODE_ENV=local node scripts/syncOracleAccountNumberEntry.js
 *   NODE_ENV=local node scripts/syncOracleAccountNumberEntry.js --dry-run
 *   NODE_ENV=local node scripts/syncOracleAccountNumberEntry.js --delay 200
 *
 * Options:
 *   --delay N     ms between each customer update (default: 0)
 *   --dry-run     Fetch and report what would be updated, but don't write to Shopify
 */

import axios from 'axios';
import { salesforceLogin } from '../common/salesforceService';

const STORE_URL   = process.env.STORE_URL;
const STORE_TOKEN = process.env.STORE_TOKEN;
const API_VERSION = process.env.SHOPIFY_SYNC_API_VERSION || '2026-01';
const SF_API_VER  = 'v60.0';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = { delay: 0, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--delay':   { const v = parseInt(args[++i], 10); opts.delay = isNaN(v) ? 0 : v; break; }
      case '--dry-run': opts.dryRun = true; break;
    }
  }

  return opts;
};

// ==================== SHOPIFY ====================

const shopifyGraphQL = async (query, variables = {}) => {
  const response = await axios.post(
    `https://${STORE_URL}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': STORE_TOKEN,
      },
    }
  );
  if (response.data.errors) {
    return { success: false, errors: response.data.errors };
  }
  return { success: true, data: response.data.data };
};

/**
 * Fetches all Shopify customers with their salesforce_account_id and
 * existing oracle_cloud_account_number metafields.
 */
const fetchAllCustomers = async () => {
  const query = `
    query getCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        edges {
          node {
            id
            email
            firstName
            lastName
            sfMetafields: metafields(first: 25, namespace: "salesforce") {
              edges {
                node { key value }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const allCustomers = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await shopifyGraphQL(query, { first: 250, after: cursor || undefined });

    if (!result.success) {
      console.error('  ❌ Failed to fetch customers page:', result.errors);
      break;
    }

    for (const edge of result.data.customers.edges) {
      const node = edge.node;
      const sfMeta = {};
      for (const mfEdge of node.sfMetafields.edges) {
        sfMeta[mfEdge.node.key] = mfEdge.node.value;
      }

      allCustomers.push({
        id: node.id,
        email: node.email,
        firstName: node.firstName,
        lastName: node.lastName,
        salesforceAccountId: sfMeta['salesforce_account_id'] || null,
        existingOracleNumber: sfMeta['oracle_cloud_account_number'] || null,
      });
    }

    hasNextPage = result.data.customers.pageInfo.hasNextPage;
    cursor = result.data.customers.pageInfo.endCursor;
    console.log(`  📥 Fetched ${allCustomers.length} customer(s) so far...`);
  }

  return allCustomers;
};

/**
 * Sets salesforce.oracle_cloud_account_number on a Shopify customer.
 */
const setOracleAccountNumberMetafield = async (customerId, value) => {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message }
      }
    }
  `;

  const result = await shopifyGraphQL(mutation, {
    metafields: [
      {
        ownerId: customerId,
        namespace: 'salesforce',
        key: 'oracle_cloud_account_number',
        value: String(value),
        type: 'single_line_text_field',
      },
    ],
  });

  if (!result.success) {
    return { success: false, errors: result.errors };
  }

  const userErrors = result.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length > 0) {
    return { success: false, errors: userErrors };
  }

  return { success: true };
};

// ==================== SALESFORCE ====================

const BATCH_SIZE = 50;

/**
 * Fetches Oracle_Cloud_Account_Number__c for the given Salesforce Account IDs.
 * Returns a map of { accountId → oracleCloudAccountNumber }.
 */
const fetchOracleAccountNumbers = async (accountIds) => {
  if (!accountIds || accountIds.length === 0) return {};

  const { accessToken, instanceUrl } = await salesforceLogin();
  const result = {};

  for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
    const batch = accountIds.slice(i, i + BATCH_SIZE);
    const idList = batch.map(id => `'${id}'`).join(',');
    const query = `SELECT Id, Oracle_Cloud_Account_Number__c FROM Account WHERE Id IN (${idList})`;

    let queryUrl = `${instanceUrl}/services/${SF_API_VER}/query?q=${encodeURIComponent(query)}`;
    while (queryUrl) {
      const response = await axios.get(queryUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      const data = response.data;
      for (const record of data.records || []) {
        if (record.Oracle_Cloud_Account_Number__c) {
          result[record.Id] = record.Oracle_Cloud_Account_Number__c;
        }
      }
      queryUrl = data.nextRecordsUrl ? `${instanceUrl}${data.nextRecordsUrl}` : null;
    }

    console.log(`  🔍 Salesforce batch ${Math.floor(i / BATCH_SIZE) + 1}: fetched ${batch.length} account(s)`);
  }

  return result;
};

// ==================== MAIN ====================

const main = async () => {
  const { delay, dryRun } = parseArgs();

  console.log('\n' + '═'.repeat(60));
  console.log('  🔢 SYNC ORACLE CLOUD ACCOUNT NUMBER → CUSTOMERS');
  console.log('═'.repeat(60));
  console.log(`  Mode:  ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Delay: ${delay}ms\n`);

  // Step 1: Fetch all Shopify customers
  console.log('Step 1: Fetching all Shopify customers...');
  const customers = await fetchAllCustomers();
  console.log(`  Total customers fetched: ${customers.length}`);

  // Step 2: Collect unique Salesforce account IDs
  const accountIdSet = new Set();
  for (const c of customers) {
    if (c.salesforceAccountId) accountIdSet.add(c.salesforceAccountId);
  }
  const accountIds = [...accountIdSet];

  console.log(`\nStep 2: Unique Salesforce account IDs with linked customers: ${accountIds.length}`);

  if (accountIds.length === 0) {
    console.log('  ⏭️  No customers have a Salesforce account ID metafield. Nothing to do.');
    process.exit(0);
  }

  // Step 3: Fetch Oracle Cloud Account Numbers from Salesforce
  console.log('\nStep 3: Fetching Oracle Cloud Account Numbers from Salesforce...');
  const oracleNumberMap = await fetchOracleAccountNumbers(accountIds);
  const accountsWithOracleNumber = Object.keys(oracleNumberMap).length;
  console.log(`  Salesforce accounts with Oracle Cloud Account Number: ${accountsWithOracleNumber}`);

  // Step 4: Update each customer metafield
  console.log('\nStep 4: Updating customer metafields...');
  const results = { updated: 0, skipped: 0, failed: 0 };
  const failedList = [];

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const label = customer.email || customer.id;
    const prefix = `  [${i + 1}/${customers.length}]`;

    if (!customer.salesforceAccountId) {
      console.log(`${prefix} ⏭️  ${label} — no Salesforce account ID, skipping`);
      results.skipped++;
      continue;
    }

    const oracleNumber = oracleNumberMap[customer.salesforceAccountId];

    if (!oracleNumber) {
      console.log(`${prefix} ⏭️  ${label} — no Oracle Cloud Account Number in Salesforce, skipping`);
      results.skipped++;
      continue;
    }

    if (customer.existingOracleNumber === String(oracleNumber)) {
      console.log(`${prefix} ⏭️  ${label} — already up to date (${oracleNumber}), skipping`);
      results.skipped++;
      continue;
    }

    console.log(`${prefix} ✏️  ${label}`);
    console.log(`    oracle_cloud_account_number: ${customer.existingOracleNumber || '(none)'} → ${oracleNumber}`);

    if (!dryRun) {
      try {
        const updateResult = await setOracleAccountNumberMetafield(customer.id, oracleNumber);
        if (updateResult.success) {
          results.updated++;
        } else {
          console.warn(`    ⚠️  Update failed:`, JSON.stringify(updateResult.errors));
          results.failed++;
          failedList.push({ id: customer.id, email: customer.email, errors: updateResult.errors });
        }
      } catch (err) {
        console.error(`    ❌ Exception:`, err.message);
        results.failed++;
        failedList.push({ id: customer.id, email: customer.email, error: err.message });
      }
    } else {
      results.updated++;
    }

    if (delay > 0 && i < customers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Total customers:  ${customers.length}`);
  console.log(`  Updated${dryRun ? ' (dry run)' : ''}:        ${results.updated}`);
  console.log(`  Skipped:          ${results.skipped}`);
  console.log(`  Failed:           ${results.failed}`);

  if (failedList.length > 0) {
    console.log('\n  Failed customers:');
    for (const f of failedList) {
      console.log(`    - ${f.email || f.id}: ${JSON.stringify(f.errors || f.error)}`);
    }
  }

  console.log('═'.repeat(60) + '\n');
  process.exit(results.failed > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
