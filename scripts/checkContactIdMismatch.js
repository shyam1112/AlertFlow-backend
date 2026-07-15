/**
 * Check Contact ID Mismatch
 *
 * Fetches all Shopify customers, compares the sf_contact_XXXX tag
 * against the salesforce.salesforce_contact_id metafield.
 * Generates an Excel report of customers where they differ.
 *
 * Usage:
 *   node scripts/checkContactIdMismatchEntry.js
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

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

// ==================== FETCH ALL CUSTOMERS ====================

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
            tags
            sfMetafields: metafields(first: 20, namespace: "salesforce") {
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
      console.error('❌ Failed to fetch customers page:', result.errors);
      break;
    }

    for (const edge of result.data.customers.edges) {
      const node = edge.node;

      const sfMeta = {};
      for (const mfEdge of node.sfMetafields.edges) {
        sfMeta[mfEdge.node.key] = mfEdge.node.value;
      }

      // Extract contact ID from tag: sf_contact_XXXX
      const sfTag = (node.tags || []).find(t => t.startsWith('sf_contact_'));
      const tagContactId = sfTag ? sfTag.replace('sf_contact_', '') : null;
      const metafieldContactId = sfMeta['salesforce_contact_id'] || null;

      allCustomers.push({
        id: node.id,
        email: node.email || '',
        firstName: node.firstName || '',
        lastName: node.lastName || '',
        tagContactId,
        metafieldContactId,
        salesforceAccountId: sfMeta['salesforce_account_id'] || null,
        rawTag: sfTag || null,
      });
    }

    hasNextPage = result.data.customers.pageInfo.hasNextPage;
    cursor = result.data.customers.pageInfo.endCursor;
    process.stdout.write(`\r  📥 Fetched ${allCustomers.length} customers so far...`);
  }

  process.stdout.write('\n');
  return allCustomers;
};

// ==================== MAIN ====================

const main = async () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 CHECK SF CONTACT ID MISMATCH — TAG vs METAFIELD');
  console.log('═'.repeat(60));
  console.log(`  Store: ${STORE_URL}`);
  console.log('═'.repeat(60) + '\n');

  const allCustomers = await fetchAllCustomers();
  console.log(`\n✅ Total customers fetched: ${allCustomers.length}`);

  // Categorise
  const mismatched  = [];
  const matched     = [];
  const tagOnly     = []; // has tag but no metafield
  const metaOnly    = []; // has metafield but no tag
  const neither     = []; // no tag and no metafield

  for (const c of allCustomers) {
    const hasTag  = !!c.tagContactId;
    const hasMeta = !!c.metafieldContactId;

    if (!hasTag && !hasMeta) {
      neither.push(c);
    } else if (hasTag && !hasMeta) {
      tagOnly.push(c);
    } else if (!hasTag && hasMeta) {
      metaOnly.push(c);
    } else if (c.tagContactId === c.metafieldContactId) {
      matched.push(c);
    } else {
      mismatched.push(c);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  📊 RESULTS');
  console.log('═'.repeat(60));
  console.log(`  Total customers:           ${allCustomers.length}`);
  console.log(`  ✅ Tag & metafield match:   ${matched.length}`);
  console.log(`  ❌ Mismatch (tag ≠ meta):   ${mismatched.length}`);
  console.log(`  ⚠️  Tag only (no metafield): ${tagOnly.length}`);
  console.log(`  ⚠️  Metafield only (no tag): ${metaOnly.length}`);
  console.log(`  —  No SF contact data:      ${neither.length}`);
  console.log('═'.repeat(60) + '\n');

  if (mismatched.length === 0) {
    console.log('✅ No mismatches found!');
  } else {
    console.log(`❌ ${mismatched.length} mismatch(es) found:`);
    for (const c of mismatched) {
      console.log(`  • ${c.email} — tag: ${c.tagContactId} | metafield: ${c.metafieldContactId}`);
    }
  }

  // ==================== EXCEL REPORT ====================

  const buildRow = (c) => ({
    'Shopify Customer ID':       c.id,
    'Email':                     c.email,
    'First Name':                c.firstName,
    'Last Name':                 c.lastName,
    'Tag Contact ID':            c.tagContactId || '',
    'Metafield Contact ID':      c.metafieldContactId || '',
    'Salesforce Account ID':     c.salesforceAccountId || '',
    'Raw Tag':                   c.rawTag || '',
  });

  const summaryRows = [
    { 'Metric': 'Total Customers',                    'Value': allCustomers.length },
    { 'Metric': 'Tag & Metafield Match',              'Value': matched.length },
    { 'Metric': 'Mismatch (tag ≠ metafield)',         'Value': mismatched.length },
    { 'Metric': 'Tag Only (no metafield)',            'Value': tagOnly.length },
    { 'Metric': 'Metafield Only (no tag)',            'Value': metaOnly.length },
    { 'Metric': 'No SF Contact Data',                 'Value': neither.length },
    { 'Metric': 'Generated At',                       'Value': new Date().toISOString() },
  ];

  const reportsDir = path.resolve('reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName  = `contact_id_mismatch_${timestamp}.xlsx`;
  const filePath  = path.join(reportsDir, fileName);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  if (mismatched.length > 0)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(mismatched.map(buildRow)), 'Mismatch');
  if (tagOnly.length > 0)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(tagOnly.map(buildRow)), 'Tag Only');
  if (metaOnly.length > 0)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metaOnly.map(buildRow)), 'Metafield Only');

  XLSX.writeFile(workbook, filePath);
  console.log(`\n📄 Report saved: ${filePath}`);
};

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
