/**
 * Tax Category Sync Runner
 *
 * Fetches products from Shopify, looks up Tax_Category_Code__c from Salesforce
 * by SKU (ProductCode), and sets the `vertex.product_class` metafield on each
 * matching Shopify product.
 *
 * Usage:
 *   node scripts/taxCategoryEntry.js                          # all products
 *   node scripts/taxCategoryEntry.js --count 50              # first 50 products
 *   node scripts/taxCategoryEntry.js --shopify-ids 8891836661972,9001234567890
 *   node scripts/taxCategoryEntry.js --dry-run
 *   node scripts/taxCategoryEntry.js --count 100 --delay 500
 *
 * Options:
 *   --count N              Process first N Shopify products (default: all)
 *   --shopify-ids IDS      Comma-separated Shopify product numeric IDs
 *   --delay N              ms between Shopify metafield writes (default: 300)
 *   --dry-run              Fetch and log only — no Shopify writes
 */

import axios from 'axios';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';
import { salesforceLogin } from '../common/salesforceService';
import logger from '../common/logger';

const STORE_URL = process.env.STORE_URL;
const STORE_TOKEN = process.env.STORE_TOKEN;
const API_VERSION = process.env.SHOPIFY_SYNC_API_VERSION || '2026-01';

// ==================== SHOPIFY GRAPHQL ====================

const shopifyGraphQL = async (query, variables = {}) => {
  try {
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
      logger.error('Shopify GraphQL errors', { errors: response.data.errors });
      return { success: false, errors: response.data.errors };
    }

    return { success: true, data: response.data.data };
  } catch (error) {
    logger.error('Shopify GraphQL request failed', {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
};

// ==================== FETCH SHOPIFY PRODUCTS ====================

/**
 * Paginates through all Shopify products.
 * Returns array of { id, title, status, sku }
 * @param {number} count - Max products to fetch (0 = all)
 */
const fetchAllShopifyProducts = async (count = 0) => {
  const allProducts = [];
  let cursor = null;
  const pageSize = 50;

  console.log(`\n📦 Fetching Shopify products${count > 0 ? ` (limit: ${count})` : ' (all)'}...`);

  do {
    const remaining = count > 0 ? count - allProducts.length : pageSize;
    const fetchSize = Math.min(pageSize, remaining || pageSize);

    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              status
              variants(first: 1) {
                edges {
                  node {
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { first: fetchSize, after: cursor });

    if (!result.success) {
      console.error('❌ Failed to fetch Shopify products:', result.errors);
      break;
    }

    const { edges, pageInfo } = result.data.products;

    for (const edge of edges) {
      allProducts.push({
        id: edge.node.id,
        title: edge.node.title,
        status: edge.node.status,
        sku: edge.node.variants?.edges?.[0]?.node?.sku || null,
      });
    }

    console.log(`   Fetched ${allProducts.length} products so far...`);
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;

    if (count > 0 && allProducts.length >= count) break;

    if (cursor) await new Promise(r => setTimeout(r, 200));
  } while (cursor);

  console.log(`✅ Total Shopify products fetched: ${allProducts.length}`);
  return allProducts;
};

/**
 * Fetches specific Shopify products by numeric product IDs.
 * @param {string[]} numericIds - Array of numeric product ID strings
 */
const fetchShopifyProductsByIds = async (numericIds) => {
  const gids = numericIds.map(id => `gid://shopify/Product/${id}`);
  console.log(`\n📦 Fetching ${gids.length} specific Shopify product(s)...`);

  const allProducts = [];
  const batchSize = 250;

  for (let i = 0; i < gids.length; i += batchSize) {
    const batch = gids.slice(i, i + batchSize);

    const query = `
      query getNodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            status
            variants(first: 1) {
              edges {
                node {
                  sku
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { ids: batch });

    if (!result.success) {
      console.error('❌ Failed to fetch Shopify products by IDs:', result.errors);
      continue;
    }

    for (const node of (result.data.nodes || [])) {
      if (node && node.id) {
        allProducts.push({
          id: node.id,
          title: node.title,
          status: node.status,
          sku: node.variants?.edges?.[0]?.node?.sku || null,
        });
      }
    }
  }

  console.log(`✅ Fetched ${allProducts.length} product(s)`);
  return allProducts;
};

// ==================== SALESFORCE QUERY ====================

/**
 * Batch-queries Salesforce for Tax_Category_Code__c by ProductCode (SKU).
 * @param {string[]} skus - Array of SKUs (ProductCodes)
 * @returns {object} Map of { sku -> Tax_Category_Code__c }
 */
const fetchSalesforceTaxCategories = async (skus) => {
  if (skus.length === 0) return {};

  const { accessToken, instanceUrl } = await salesforceLogin();
  const taxCategoryMap = {};
  const batchSize = 100; // Keep SOQL query length within safe limits

  console.log(`\n🔍 Querying Salesforce Tax_Category_Code__c for ${skus.length} SKU(s)...`);

  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);
    const skuList = batch.map(s => `'${String(s).replace(/'/g, "\\'")}'`).join(', ');

    const soql = `SELECT ProductCode, Tax_Category_Code__c FROM Product2 WHERE ProductCode IN (${skuList})`;

    const response = await axios.get(
      `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    for (const record of (response.data.records || [])) {
      if (record.ProductCode) {
        taxCategoryMap[record.ProductCode] = record.Tax_Category_Code__c || null;
      }
    }

    console.log(`   Queried ${Math.min(i + batchSize, skus.length)}/${skus.length} SKUs`);
  }

  const found = Object.values(taxCategoryMap).filter(v => v !== null).length;
  console.log(`✅ Tax Category Code found for ${found} / ${skus.length} SKUs`);
  return taxCategoryMap;
};

// ==================== SET SHOPIFY METAFIELD ====================

/**
 * Sets vertex.product_class metafield on a Shopify product.
 * @param {string} productId - Shopify product GID
 * @param {string} taxCategoryCode - Value from Salesforce Tax_Category_Code__c
 */
const setProductTaxMetafield = async (productId, taxCategoryCode) => {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        ownerId: productId,
        namespace: 'vertex',
        key: 'product_class',
        type: 'single_line_text_field',
        value: String(taxCategoryCode),
      },
    ],
  };

  const result = await shopifyGraphQL(mutation, variables);

  if (!result.success) {
    return { success: false, errors: result.errors };
  }

  const { metafields, userErrors } = result.data.metafieldsSet;

  if (userErrors && userErrors.length > 0) {
    return { success: false, errors: userErrors };
  }

  return { success: true, metafield: metafields?.[0] };
};

// ==================== CLI ARG PARSING ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    count: 0,        // 0 = all
    shopifyIds: null,
    delay: 0,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':
        opts.count = parseInt(args[++i], 10) || 0;
        break;
      case '--shopify-ids': {
        const val = args[i + 1];
        if (!val || val.startsWith('--')) {
          console.error('❌ --shopify-ids requires a value, e.g. --shopify-ids 8891836661972,9001234567890');
          process.exit(1);
        }
        opts.shopifyIds = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      }
      case '--delay':
        opts.delay = parseInt(args[++i], 10) || 300;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
    }
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const { count, shopifyIds, delay, dryRun } = parseArgs();

  console.log('\n' + '═'.repeat(62));
  console.log('  🏷️   SHOPIFY PRODUCT TAX CATEGORY SYNC');
  console.log('  Salesforce Tax_Category_Code__c → vertex.product_class');
  console.log('═'.repeat(62));
  if (shopifyIds) {
    console.log(`  Mode:      Specific product IDs (${shopifyIds.length})`);
    console.log(`  IDs:       ${shopifyIds.slice(0, 5).join(', ')}${shopifyIds.length > 5 ? ` ... +${shopifyIds.length - 5} more` : ''}`);
  } else {
    console.log(`  Mode:      All products${count > 0 ? ` (first ${count})` : ''}`);
  }
  console.log(`  Delay:     ${delay}ms between writes`);
  console.log(`  Dry Run:   ${dryRun}`);
  console.log('═'.repeat(62) + '\n');

  // ── Step 1: Fetch Shopify products ──────────────────────────────
  let shopifyProducts;

  if (shopifyIds && shopifyIds.length > 0) {
    shopifyProducts = await fetchShopifyProductsByIds(shopifyIds);
  } else {
    shopifyProducts = await fetchAllShopifyProducts(count);
  }

  if (shopifyProducts.length === 0) {
    console.log('✅ No Shopify products found. Exiting.');
    process.exit(0);
  }

  // ── Step 2: Batch-query Salesforce by SKU ───────────────────────
  const productsWithSku = shopifyProducts.filter(p => p.sku);
  const productsWithoutSku = shopifyProducts.filter(p => !p.sku);

  if (productsWithoutSku.length > 0) {
    console.log(`\n⚠️  ${productsWithoutSku.length} product(s) have no SKU — will be skipped`);
  }

  const uniqueSkus = [...new Set(productsWithSku.map(p => p.sku))];
  const taxCategoryMap = await fetchSalesforceTaxCategories(uniqueSkus);

  // ── Step 3: Set metafields on each product ──────────────────────
  const results = {
    successful: [],
    failed: [],
    skipped: [],
    notFound: [],
  };

  console.log(`\n⚙️  Processing ${shopifyProducts.length} product(s)...\n`);

  for (let i = 0; i < shopifyProducts.length; i++) {
    const product = shopifyProducts[i];
    console.log(`[${i + 1}/${shopifyProducts.length}] "${product.title}" (SKU: ${product.sku || 'none'})`);

    // Skip — no SKU
    if (!product.sku) {
      results.skipped.push({ ...product, reason: 'No SKU on Shopify product' });
      console.log('   ⏭️  Skipped — no SKU');
      continue;
    }

    const taxCategoryCode = taxCategoryMap[product.sku];

    // Skip — SKU not present in Salesforce at all
    if (taxCategoryCode === undefined) {
      results.notFound.push({ ...product, reason: 'SKU not found in Salesforce Product2' });
      console.log('   ❌ Not found in Salesforce');
      continue;
    }

    // Skip — Tax_Category_Code__c is null/empty in Salesforce
    if (!taxCategoryCode) {
      results.skipped.push({ ...product, taxCategoryCode: null, reason: 'Tax_Category_Code__c is empty in Salesforce' });
      console.log('   ⏭️  Skipped — Tax_Category_Code__c is empty');
      continue;
    }

    console.log(`   Tax Category Code: ${taxCategoryCode}`);

    if (dryRun) {
      results.successful.push({ ...product, taxCategoryCode, dryRun: true });
      console.log(`   🔍 DRY RUN — would set vertex.product_class = "${taxCategoryCode}"`);
      continue;
    }

    const setResult = await setProductTaxMetafield(product.id, taxCategoryCode);

    if (setResult.success) {
      results.successful.push({ ...product, taxCategoryCode, metafieldId: setResult.metafield?.id });
      console.log(`   ✅ Set vertex.product_class = "${taxCategoryCode}"`);
    } else {
      const errorMsg = JSON.stringify(setResult.errors);
      results.failed.push({ ...product, taxCategoryCode, error: errorMsg });
      console.error(`   ❌ Failed: ${errorMsg}`);
      logger.error('Tax category metafield update failed', {
        productId: product.id,
        title: product.title,
        sku: product.sku,
        taxCategoryCode,
        errors: setResult.errors,
      });
    }

    if (i < shopifyProducts.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // ── Step 4: Summary ─────────────────────────────────────────────
  console.log('\n' + '═'.repeat(62));
  console.log('  📊 SYNC COMPLETE');
  console.log('═'.repeat(62));
  console.log(`  Total Products:             ${shopifyProducts.length}`);
  console.log(`  Updated (vertex.product_class): ${results.successful.length}`);
  console.log(`  Failed:                     ${results.failed.length}`);
  console.log(`  Skipped (no SKU / empty):   ${results.skipped.length}`);
  console.log(`  Not Found in Salesforce:    ${results.notFound.length}`);
  if (dryRun) console.log(`  ⚠️  DRY RUN — no changes were written to Shopify`);
  console.log('═'.repeat(62));

  // ── Step 5: Excel report ────────────────────────────────────────
  const reportsDir = path.resolve('reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `tax_category_sync_${timestamp}.xlsx`;
  const filePath = path.join(reportsDir, fileName);

  const summaryRows = [
    { Metric: 'Total Products', Value: shopifyProducts.length },
    { Metric: 'Updated (vertex.product_class)', Value: results.successful.length },
    { Metric: 'Failed', Value: results.failed.length },
    { Metric: 'Skipped (no SKU / empty code)', Value: results.skipped.length },
    { Metric: 'Not Found in Salesforce', Value: results.notFound.length },
    { Metric: '', Value: '' },
    { Metric: 'Dry Run', Value: dryRun ? 'Yes' : 'No' },
    { Metric: 'Sync Date', Value: new Date().toISOString() },
    { Metric: 'Count Filter', Value: count > 0 ? count : 'all' },
    { Metric: 'Product IDs Filter', Value: shopifyIds ? shopifyIds.join(', ') : 'none' },
  ];

  const buildRow = (r, status) => ({
    'Status': status,
    'Shopify Product ID': r.id || '',
    'Title': r.title || '',
    'SKU': r.sku || '',
    'Tax Category Code (Salesforce)': r.taxCategoryCode ?? '',
    'Metafield ID': r.metafieldId || '',
    'Reason / Error': r.reason || r.error || '',
  });

  const successRows = results.successful.map(r => buildRow(r, dryRun ? 'Dry Run' : 'Updated'));
  const failedRows = results.failed.map(r => buildRow(r, 'Failed'));
  const skippedRows = results.skipped.map(r => buildRow(r, 'Skipped'));
  const notFoundRows = results.notFound.map(r => buildRow(r, 'Not Found in Salesforce'));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  if (successRows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(successRows), dryRun ? 'Dry Run' : 'Updated');
  if (failedRows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(failedRows), 'Failed');
  if (skippedRows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(skippedRows), 'Skipped');
  if (notFoundRows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(notFoundRows), 'Not Found');

  XLSX.writeFile(workbook, filePath);
  console.log(`\n✅ Report saved: ${filePath}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
};

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
