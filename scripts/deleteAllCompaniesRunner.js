/**
 * Delete All Shopify Companies Runner
 *
 * Fetches every company from Shopify (paginated) and deletes them one by one.
 * Shows a confirmation prompt before proceeding.
 *
 * Usage:
 *   node scripts/deleteAllCompanies.js                  # Delete all companies
 *   node scripts/deleteAllCompanies.js --dry-run        # Preview only, nothing deleted
 *   node scripts/deleteAllCompanies.js --limit 10       # Delete at most 10 companies
 *   node scripts/deleteAllCompanies.js --delay 200      # ms between each delete (default: 100)
 *   node scripts/deleteAllCompanies.js --batch-size 50  # Companies fetched per page (default: 250)
 */

import axios from 'axios';
import readline from 'readline';

// ==================== CONFIG ====================

const STORE_URL   = process.env.STORE_URL;
const STORE_TOKEN = process.env.STORE_TOKEN;
const API_VERSION = process.env.SHOPIFY_SYNC_API_VERSION || '2026-01';

// ==================== SHOPIFY GRAPHQL ====================

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

// ==================== FETCH ALL COMPANIES (PAGINATED) ====================

const fetchAllCompanies = async (batchSize = 250, maxLimit = Infinity) => {
  const companies = [];
  let cursor = null;
  let hasNextPage = true;
  let pageNum = 1;

  const query = `
    query getCompanies($first: Int!, $after: String) {
      companies(first: $first, after: $after) {
        edges {
          node {
            id
            name
            externalId
          }
          cursor
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

  while (hasNextPage && companies.length < maxLimit) {
    const remaining = maxLimit === Infinity ? batchSize : Math.min(batchSize, maxLimit - companies.length);

    process.stdout.write(`\r  Fetching page ${pageNum} (${companies.length} fetched so far)...`);

    const result = await shopifyGraphQL(query, { first: remaining, after: cursor });

    if (!result.success) {
      console.error('\n❌ Failed to fetch companies:', result.errors);
      break;
    }

    const edges = result.data.companies.edges;
    hasNextPage = result.data.companies.pageInfo.hasNextPage;

    for (const edge of edges) {
      companies.push(edge.node);
    }

    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    pageNum++;

    if (!hasNextPage || !cursor) break;

    // Small pause between pages to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  process.stdout.write('\n');
  return companies;
};

// ==================== REMOVE ALL CONTACTS FROM A COMPANY ====================

const removeCompanyContacts = async (companyId) => {
  // Fetch all company contacts
  const query = `
    query getCompanyContacts($companyId: ID!) {
      company(id: $companyId) {
        contacts(first: 250) {
          edges {
            node {
              id
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query, { companyId });

  if (!result.success || !result.data.company) return;

  const contacts = result.data.company.contacts.edges.map(e => e.node.id);

  if (contacts.length === 0) return;

  // Delete each contact
  const mutation = `
    mutation companyContactDelete($companyContactId: ID!) {
      companyContactDelete(companyContactId: $companyContactId) {
        deletedCompanyContactId
        userErrors {
          field
          message
        }
      }
    }
  `;

  for (const contactId of contacts) {
    await shopifyGraphQL(mutation, { companyContactId: contactId });
    await new Promise(r => setTimeout(r, 50));
  }
};

// ==================== DELETE A SINGLE COMPANY ====================

const deleteCompany = async (companyId) => {
  // Must remove contacts first — Shopify blocks deletion if contacts exist
  await removeCompanyContacts(companyId);

  const mutation = `
    mutation companyDelete($id: ID!) {
      companyDelete(id: $id) {
        deletedCompanyId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(mutation, { id: companyId });

  if (!result.success) {
    return { success: false, errors: result.errors };
  }

  const userErrors = result.data.companyDelete.userErrors || [];
  if (userErrors.length > 0) {
    return { success: false, errors: userErrors };
  }

  return { success: true, deletedId: result.data.companyDelete.deletedCompanyId };
};

// ==================== CONFIRMATION PROMPT ====================

const confirm = (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
};

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    dryRun:    false,
    limit:     Infinity,
    delay:     100,
    batchSize: 250,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':                     opts.dryRun    = true;                         break;
      case '--limit':      opts.limit     = parseInt(args[++i], 10) || Infinity;            break;
      case '--delay':      opts.delay     = parseInt(args[++i], 10) || 100;                 break;
      case '--batch-size': opts.batchSize = parseInt(args[++i], 10) || 250;                 break;
    }
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  if (!STORE_URL || !STORE_TOKEN) {
    console.error('❌ Missing Shopify credentials.');
    console.error('   STORE_URL:   ', STORE_URL   ? '✓' : '✗ (not set)');
    console.error('   STORE_TOKEN: ', STORE_TOKEN ? '✓' : '✗ (not set)');
    process.exit(1);
  }

  const { dryRun, limit, delay, batchSize } = parseArgs();

  console.log('\n' + '═'.repeat(60));
  console.log('  DELETE ALL SHOPIFY COMPANIES');
  console.log('═'.repeat(60));
  console.log(`  Store:      ${STORE_URL}`);
  console.log(`  API:        ${API_VERSION}`);
  console.log(`  Dry Run:    ${dryRun}`);
  console.log(`  Limit:      ${limit === Infinity ? 'All' : limit}`);
  console.log(`  Delay:      ${delay}ms between deletes`);
  console.log(`  Page Size:  ${batchSize}`);
  console.log('═'.repeat(60) + '\n');

  // Step 1: Fetch all companies
  console.log('📋 Fetching all companies from Shopify...');
  const companies = await fetchAllCompanies(batchSize, limit);

  if (companies.length === 0) {
    console.log('✅ No companies found. Nothing to delete.');
    process.exit(0);
  }

  console.log(`\n📊 Found ${companies.length} company/companies.\n`);

  // Show sample of what will be deleted
  const preview = companies.slice(0, 5);
  console.log('  Sample of companies to be deleted:');
  preview.forEach((c, i) => {
    console.log(`    ${i + 1}. ${c.name} — externalId: ${c.externalId || '(none)'} — ${c.id}`);
  });
  if (companies.length > 5) {
    console.log(`    ... and ${companies.length - 5} more`);
  }
  console.log();

  // Step 2: Confirmation
  if (dryRun) {
    console.log('🔍 DRY RUN — no companies will be deleted.\n');
  } else {
    const answer = await confirm(
      `⚠️  Are you sure you want to permanently delete ALL ${companies.length} company/companies? Type "yes" to confirm: `
    );

    if (answer !== 'yes') {
      console.log('\n❌ Aborted. No companies were deleted.');
      process.exit(0);
    }
    console.log();
  }

  // Step 3: Delete
  let deleted = 0;
  let failed  = 0;
  const errors = [];

  const startTime = Date.now();

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const label = `[${i + 1}/${companies.length}] ${company.name} (${company.externalId || company.id})`;

    if (dryRun) {
      console.log(`  🔍 Would delete: ${label}`);
      deleted++;
      continue;
    }

    try {
      const result = await deleteCompany(company.id);

      if (result.success) {
        deleted++;
        process.stdout.write(`\r  ✅ ${deleted} deleted, ${failed} failed — ${label.slice(0, 60)}...`);
      } else {
        failed++;
        const errMsg = (result.errors || []).map(e => e.message || JSON.stringify(e)).join(', ');
        errors.push({ id: company.id, name: company.name, error: errMsg });
        console.log(`\n  ❌ Failed: ${label} — ${errMsg}`);
      }
    } catch (err) {
      failed++;
      errors.push({ id: company.id, name: company.name, error: err.message });
      console.log(`\n  ❌ Error: ${label} — ${err.message}`);
    }

    // Delay between deletes to respect rate limits
    if (delay > 0 && i < companies.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Step 4: Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n' + '═'.repeat(60));
  console.log('  DONE');
  console.log('═'.repeat(60));
  console.log(`  Total found:   ${companies.length}`);
  console.log(`  Deleted:       ${deleted}`);
  console.log(`  Failed:        ${failed}`);
  console.log(`  Time:          ${elapsed}s`);
  if (dryRun) {
    console.log('  (Dry run — nothing was actually deleted)');
  }
  console.log('═'.repeat(60));

  if (errors.length > 0) {
    console.log('\n⚠️  Failed deletions:');
    errors.forEach(e => {
      console.log(`   - ${e.name} (${e.id}): ${e.error}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
