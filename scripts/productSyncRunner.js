/**
 * Product Sync Runner
 * Syncs Salesforce products to Shopify (standalone script — no HTTP server needed).
 *
 * Usage:
 *   node scripts/productSyncEntry.js
 *   node scripts/productSyncEntry.js --count 50
 *   node scripts/productSyncEntry.js --count 50 --offset 100
 *   node scripts/productSyncEntry.js --skip-existing false
 *   node scripts/productSyncEntry.js --product-name "Laser Pro"
 *   node scripts/productSyncEntry.js --salesforce-ids 01t1234567890,01t9876543210
 *   node scripts/productSyncEntry.js --dry-run
 *
 * Options:
 *   --count N              Number of products to fetch from Salesforce (default: 100)
 *   --offset N             Number of records to skip (default: 0)
 *   --skip-existing        Skip products already in Shopify by SKU (default: true)
 *   --no-skip-existing     Don't skip existing products
 *   --product-name NAME    Filter by specific product name (for testing)
 *   --salesforce-ids IDS   Comma-separated Salesforce product IDs
 *   --dry-run              Fetch and validate only — no Shopify writes
 */

import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';

import { fetchSalesforceProducts } from '../common/salesforceService';
import {
  createShopifyProductsBatch,
  setVariantInternationalPrices,
  getShopifyPriceLists,
  ensureMetafieldDefinitions,
  getShopifyCatalogs,
  clearMetafieldDefinitionsCache,
  createCatalog,
  createPriceList,
} from '../common/shopifyProductService';

const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
};
import logger from '../common/logger';

// ==================== ALLOWED CATALOG CONFIGURATIONS ====================

const ALLOWED_CATALOG_CONFIGS = [
  { catalogTitle: 'Online-Store US - USD',          pricebookName: 'Online-Store US',         currencyCode: 'USD' },
  // { catalogTitle: 'Online-Store UK - GBP',          pricebookName: 'Online-Store UK',         currencyCode: 'GBP' },
  // { catalogTitle: 'Online-Store CA - CAD',          pricebookName: 'Online-Store CA',         currencyCode: 'CAD' },
  // { catalogTitle: 'B2B Standard Price Book - NZD',  pricebookName: 'B2B Standard Price Book', currencyCode: 'NZD' },
  // { catalogTitle: 'B2B Standard Price Book - ANZ',  pricebookName: 'B2B Standard Price Book', currencyCode: 'AUD' },
];

const VALID_PPC_FLAGS = ['PPC', 'PPC - Non Inventory', 'PPC \u2013 Non Inventory'];

// ==================== CATALOG SETUP ====================

const ensureRequiredCatalogs = async () => {
  console.log('\n========== STEP 1: SHOPIFY CATALOG SETUP ==========');

  const existingCatalogs = await getShopifyCatalogs(true);
  const priceLists = await getShopifyPriceLists();
  const catalogMap = {};

  for (const config of ALLOWED_CATALOG_CONFIGS) {
    const key = `${config.pricebookName}:${config.currencyCode}`;
    console.log(`\n  Checking: "${config.catalogTitle}"...`);

    let catalog = existingCatalogs.find(
      c => c.title.toLowerCase().trim() === config.catalogTitle.toLowerCase().trim()
    );

    if (catalog) {
      console.log(`  ✅ Already exists: "${catalog.title}" (${catalog.id})`);
    } else {
      console.log(`  ⚠️ Not found — creating "${config.catalogTitle}"...`);
      const result = await createCatalog(config.catalogTitle);

      if (result && !result.alreadyExists) {
        catalog = result;
        console.log(`  ✅ Created: "${config.catalogTitle}" (${catalog.id})`);
      } else {
        const refreshed = await getShopifyCatalogs(true);
        catalog = refreshed.find(
          c => c.title.toLowerCase().trim() === config.catalogTitle.toLowerCase().trim()
        );
        if (catalog) {
          console.log(`  ✅ Found after re-fetch: "${catalog.title}" (${catalog.id})`);
        } else {
          console.error(`  ❌ Could not find or create catalog "${config.catalogTitle}" — skipping`);
          continue;
        }
      }
    }

    const existingPriceList = priceLists.find(
      pl => pl.catalogId === catalog.id && pl.currency === config.currencyCode
    );

    if (existingPriceList) {
      console.log(`  ✅ Price list exists: "${existingPriceList.name}" (${config.currencyCode})`);
    } else {
      console.log(`  ⚠️ No ${config.currencyCode} price list — creating...`);
      const newPriceList = await createPriceList(
        `${config.catalogTitle} Prices`,
        config.currencyCode,
        catalog.id
      );
      if (newPriceList) {
        console.log(`  ✅ Price list created: "${newPriceList.name}"`);
      } else {
        console.error(`  ❌ Failed to create price list for "${config.catalogTitle}"`);
      }
    }

    catalogMap[key] = { id: catalog.id, title: config.catalogTitle };
  }

  console.log('====================================================\n');
  return catalogMap;
};

// ==================== PRODUCT TRANSFORM ====================

const transformProducts = (salesforceProducts, requiredCatalogs) => {
  const validatedProducts = [];
  const invalidProducts = [];

  const currencyToRegion = {
    'USD': 'US', 'CAD': 'CA', 'GBP': 'UK', 'NZD': 'NZ', 'AUD': 'AU',
  };

  for (const product of salesforceProducts) {
    const pricebookEntries = product.PricebookEntries?.records || [];
    const activePricebookEntries = pricebookEntries.filter(e => e.IsActive === true);

    const hasPpcFlag = VALID_PPC_FLAGS.includes(product.PPC_Flag__c);
    const hasViewInEstore = product.View_in_eStore__c === true;
    const hasWebName = !!product.Web_Name__c;
    const hasMatchingPricebook = activePricebookEntries.some(entry =>
      ALLOWED_CATALOG_CONFIGS.some(
        config =>
          config.pricebookName === entry.Pricebook2?.Name &&
          config.currencyCode === entry.CurrencyIsoCode
      )
    );

    if (!hasPpcFlag || !hasViewInEstore || !hasWebName || !hasMatchingPricebook) {
      const reasons = [
        !hasPpcFlag && `PPC flag invalid: "${product.PPC_Flag__c}"`,
        !hasViewInEstore && `View_in_eStore__c = false`,
        !hasWebName && `Web_Name__c is empty`,
        !hasMatchingPricebook && `No active pricebook entry matches any allowed catalog`,
      ].filter(Boolean);
      invalidProducts.push({ id: product.Id, name: product.Name, reasons });
      continue;
    }

    // Build international prices
    const internationalPrices = [];
    const regionalAvailability = new Set();

    for (const config of ALLOWED_CATALOG_CONFIGS) {
      const matchingEntry = activePricebookEntries.find(
        entry =>
          entry.Pricebook2?.Name === config.pricebookName &&
          entry.CurrencyIsoCode === config.currencyCode
      );

      if (matchingEntry) {
        const catalogInfo = requiredCatalogs[`${config.pricebookName}:${config.currencyCode}`];
        internationalPrices.push({
          currencyCode: config.currencyCode,
          price: matchingEntry.UnitPrice,
          pricebookName: config.pricebookName,
          catalogTitle: config.catalogTitle,
          catalogId: catalogInfo?.id || null,
          needsCatalogLookup: false,
          region: currencyToRegion[config.currencyCode] || null,
        });
        if (currencyToRegion[config.currencyCode]) {
          regionalAvailability.add(currencyToRegion[config.currencyCode]);
        }
      }
    }

    const onlineStoreUSEntry = activePricebookEntries.find(
      entry => entry.Pricebook2?.Name === 'Online-Store US' && entry.CurrencyIsoCode === 'USD'
    );
    const price = onlineStoreUSEntry?.UnitPrice ?? 0;
    const title = product.Web_Name__c || product.Name;
    const status = (product.View_in_eStore__c === true && product.IsActive !== false) ? 'ACTIVE' : 'DRAFT';

    validatedProducts.push({
      salesforceId: product.Id,
      productCode: product.ProductCode,
      sku: product.ProductCode || '',
      family: product.Family,
      ppcFlag: product.PPC_Flag__c,
      productCompany: product.Product_Company__c,
      createdDate: product.CreatedDate,
      title,
      description: product.Description || '',
      price,
      status,
      isActive: product.IsActive !== false,
      tags: [product.SHOP_Meta_Tags__c || '', product.SVMX_Model_Text__c ? product.SVMX_Model_Text__c.trim() : ''].filter(Boolean).join(','),
      sfName: product.Name,
      partType: product.Part_Type__c,
      modelText: product.SVMX_Model_Text__c,
      weight: product.Weight__c,
      weightUnit: product.Weight_UM__c,
      internationalPrices,
      regionalAvailability: [...regionalAvailability],
      metafields: {
        salesforceProductId: product.Id ?? null,
        ppcFlag: product.PPC_Flag__c ?? null,
        salesforceModelFilter: (() => {
          const raw = product.SHOP_Description__c || '';
          const values = stripHtml(raw).split(';').map(v => v.trim()).filter(Boolean);
          return values.length > 0 ? JSON.stringify(values) : null;
        })(),
        model: product.SVMX_Model_Text__c ?? null,
        modelProductLine: product.Model_Product_Line__c ?? null,
        qtyWidgetType: product.Qty_Weidget_Type__c ?? null,
        dimensionUM: product.Dimension_UM__c ?? null,
        dimLength: product.Dim_Length__c ?? null,
        dimWidth: product.Dim_Width__c ?? null,
        dimHeight: product.Dim_Height__c ?? null,
        lotSize: product.Lot_size__c ?? null,
        userManualFilesRoot: product.Files_Root__c ?? null,
        specialOffer: product.Special_offer__c ?? null,
        stepsForWidget: product.Steps_for_widget__c ?? null,
        taxCategoryCode: product.Tax_Category_Code__c ?? null,
      },
    });
  }

  console.log('\n========== STEP 2: PRODUCT VALIDATION ==========');
  console.log(`  Total from Salesforce : ${salesforceProducts.length}`);
  console.log(`  Valid (will sync)     : ${validatedProducts.length}`);
  console.log(`  Skipped (invalid)     : ${invalidProducts.length}`);
  if (invalidProducts.length > 0) {
    invalidProducts.forEach(p => console.log(`    ❌ ${p.name} — ${p.reasons.join(', ')}`));
  }
  console.log('=================================================\n');

  return validatedProducts;
};

// ==================== CLI ARG PARSING ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    count: 100,
    offset: 0,
    skipExisting: true,
    productName: null,
    salesforceIds: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count': {
        const parsed = parseInt(args[++i], 10);
        opts.count = isNaN(parsed) ? 100 : parsed;
        break;
      }
      case '--offset':
        opts.offset = parseInt(args[++i], 10) || 0;
        break;
      case '--skip-existing':
        opts.skipExisting = true;
        break;
      case '--no-skip-existing':
        opts.skipExisting = false;
        break;
      case '--product-name':
        opts.productName = args[++i];
        break;
      case '--salesforce-ids': {
        const val = args[i + 1];
        if (!val || val.startsWith('--')) {
          console.error('❌ --salesforce-ids requires a value');
          process.exit(1);
        }
        opts.salesforceIds = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
    }
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const { count, offset, skipExisting, productName, salesforceIds, dryRun } = parseArgs();

  console.log('\n' + '═'.repeat(60));
  console.log('  🛍️  SALESFORCE → SHOPIFY PRODUCT SYNC');
  console.log('═'.repeat(60));
  console.log(`  Count:          ${count}`);
  console.log(`  Offset:         ${offset}`);
  console.log(`  Skip Existing:  ${skipExisting}`);
  console.log(`  Product Name:   ${productName || 'none'}`);
  console.log(`  Salesforce IDs: ${salesforceIds ? salesforceIds.length + ' IDs' : 'none'}`);
  console.log(`  Dry Run:        ${dryRun}`);
  console.log('═'.repeat(60) + '\n');

  // Step 1: Fetch from Salesforce
  let salesforceProducts;
  if (salesforceIds && salesforceIds.length > 0) {
    console.log(`Fetching ${salesforceIds.length} products by Salesforce ID...`);
    salesforceProducts = await fetchSalesforceProducts(0, null, 0, salesforceIds);
  } else if (productName) {
    console.log(`Filtering by product name: "${productName}"`);
    salesforceProducts = await fetchSalesforceProducts(0, productName);
  } else {
    salesforceProducts = await fetchSalesforceProducts(count, null, offset);
  }

  console.log(`Fetched ${salesforceProducts.length} products from Salesforce`);

  if (salesforceProducts.length === 0) {
    console.log('✅ No products found. Exiting.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('\n🔍 DRY RUN — products that would be synced:\n');
    salesforceProducts.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.Name} (${p.ProductCode || 'no SKU'}) — PPC: ${p.PPC_Flag__c}, eStore: ${p.View_in_eStore__c}`);
    });
    console.log('\n✅ Dry run complete. No changes made.');
    process.exit(0);
  }

  // Step 2: Catalog setup
  const requiredCatalogs = await ensureRequiredCatalogs();

  // Step 3: Transform + validate
  const transformedProducts = transformProducts(salesforceProducts, requiredCatalogs);

  if (transformedProducts.length === 0) {
    console.log('✅ No valid products to sync after validation. Exiting.');
    process.exit(0);
  }

  // Step 4: Ensure metafield definitions
  console.log('Ensuring metafield definitions exist in Shopify...');
  clearMetafieldDefinitionsCache();
  await ensureMetafieldDefinitions();

  // Step 5: Create products in Shopify
  console.log(`\nCreating ${transformedProducts.length} products in Shopify...`);
  const shopifyResults = await createShopifyProductsBatch(transformedProducts, 500, skipExisting);

  // Step 6: International pricing
  let pricingResults = { successful: [], failed: [], skipped: [] };

  if (shopifyResults.successful.length > 0) {
    console.log(`\nSetting international prices for ${shopifyResults.successful.length} products...`);
    const priceLists = await getShopifyPriceLists();
    console.log(`Found ${priceLists.length} price lists`);

    const productsBySfId = {};
    for (const tp of transformedProducts) {
      productsBySfId[tp.salesforceId] = tp;
    }

    for (const product of shopifyResults.successful) {
      const transformedProduct = productsBySfId[product.salesforceId];
      const internationalPrices = transformedProduct?.internationalPrices || [];

      if (internationalPrices.length === 0) {
        pricingResults.skipped.push({ salesforceId: product.salesforceId, title: product.title, reason: 'No international prices' });
        continue;
      }

      const variant = product.variants?.[0];
      if (!variant?.id) {
        pricingResults.failed.push({ salesforceId: product.salesforceId, title: product.title, error: 'No variant ID' });
        continue;
      }

      const priceResult = await setVariantInternationalPrices(variant.id, product.shopifyProductId, internationalPrices);

      if (priceResult.success) {
        pricingResults.successful.push({ salesforceId: product.salesforceId, title: product.title });
      } else {
        pricingResults.failed.push({ salesforceId: product.salesforceId, title: product.title, results: priceResult.results });
      }

      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Step 8: Summary + Excel report
  console.log('\n' + '═'.repeat(60));
  console.log('  📊 SYNC COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Fetched from Salesforce:  ${salesforceProducts.length}`);
  console.log(`  Valid products:           ${transformedProducts.length}`);
  console.log(`  Created in Shopify:       ${shopifyResults.successful.length}`);
  console.log(`  Failed:                   ${shopifyResults.failed.length}`);
  console.log(`  Skipped (existing):       ${shopifyResults.skipped?.length || 0}`);
  console.log(`  Pricing successful:       ${pricingResults.successful.length}`);
  console.log(`  Pricing failed:           ${pricingResults.failed.length}`);
  console.log('═'.repeat(60));

  const reportsDir = path.resolve('reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `product_sync_runner_${timestamp}.xlsx`;
  const filePath = path.join(reportsDir, fileName);

  const summaryRows = [
    { Metric: 'Fetched from Salesforce',  Value: salesforceProducts.length },
    { Metric: 'Valid products',           Value: transformedProducts.length },
    { Metric: 'Created in Shopify',       Value: shopifyResults.successful.length },
    { Metric: 'Failed',                   Value: shopifyResults.failed.length },
    { Metric: 'Skipped (existing)',       Value: shopifyResults.skipped?.length || 0 },
    { Metric: 'Pricing successful',       Value: pricingResults.successful.length },
    { Metric: 'Pricing failed',           Value: pricingResults.failed.length },
    { Metric: '',                         Value: '' },
    { Metric: 'Count',                    Value: count },
    { Metric: 'Offset',                   Value: offset },
    { Metric: 'Skip Existing',            Value: skipExisting ? 'Yes' : 'No' },
    { Metric: 'Sync Date',                Value: new Date().toISOString() },
  ];

  const createdRows = shopifyResults.successful.map(r => ({
    Status: 'Created',
    'Salesforce ID': r.salesforceId || '',
    Title: r.title || '',
    'Shopify Product ID': r.shopifyProductId || '',
    'Shopify Variant ID': r.variants?.[0]?.id || '',
  }));

  const failedRows = shopifyResults.failed.map(r => ({
    Status: 'Failed',
    'Salesforce ID': r.salesforceId || '',
    Title: r.title || '',
    Error: JSON.stringify(r.errors || r.error || ''),
  }));

  const skippedRows = (shopifyResults.skipped || []).map(r => ({
    Status: 'Skipped',
    'Salesforce ID': r.salesforceId || '',
    Title: r.title || '',
    'Existing Shopify ID': r.existingShopifyId || '',
    Reason: r.reason || '',
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  if (createdRows.length > 0)  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(createdRows),  'Created');
  if (failedRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(failedRows),   'Failed');
  if (skippedRows.length > 0)  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(skippedRows),  'Skipped');

  XLSX.writeFile(workbook, filePath);
  console.log(`\n✅ Report saved: ${filePath}`);

  process.exit(shopifyResults.failed.length > 0 ? 1 : 0);
};

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
