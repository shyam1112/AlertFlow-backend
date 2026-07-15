/**
 * Bulk Product Sync Runner
 * Syncs all products from Salesforce to Shopify
 *
 * Usage:
 *   node scripts/bulkSync.js                    # Start fresh sync
 *   node scripts/bulkSync.js --resume           # Resume from last position
 *   node scripts/bulkSync.js --offset 1000      # Start from specific offset
 *   node scripts/bulkSync.js --limit 100        # Process only 100 products
 *   node scripts/bulkSync.js --batch-size 25    # Use smaller batches
 *   node scripts/bulkSync.js --dry-run          # Test without creating products
 *
 * Options:
 *   --resume          Resume from last saved position
 *   --offset N        Start from offset N (default: 0)
 *   --limit N         Maximum products to process (default: unlimited)
 *   --batch-size N    Products per batch (default: 50)
 *   --delay N         Delay between batches in ms (default: 2000)
 *   --skip-existing   Skip products that exist in Shopify (default: true)
 *   --no-skip-existing  Don't skip existing products
 *   --dry-run         Test mode - don't actually create products
 *   --help            Show this help
 */

import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

// Import services
import { fetchSalesforceProducts } from '../common/salesforceService';
import {
  createShopifyProductsBatch,
  setVariantInternationalPrices,
  getShopifyPriceLists,
  getShopifyCatalogs,
  ensureMetafieldDefinitions,
  clearMetafieldDefinitionsCache,
} from '../common/shopifyProductService';
import logger from '../common/logger';

// ==================== CONFIGURATION ====================
const CONFIG = {
  BATCH_SIZE: 50,           // Products per batch
  DELAY_BETWEEN_BATCHES: 2000,  // ms between batches
  DELAY_BETWEEN_PRODUCTS: 500,  // ms between products in batch
  MAX_RETRIES: 3,           // Retries for failed batches
  RETRY_DELAY: 5000,        // ms to wait before retry
  STATE_FILE: path.join(process.cwd(), 'data/sync-state.json'),
  LOG_FILE: path.join(process.cwd(), 'logs/bulk-sync.log'),
  REPORT_DIR: path.join(process.cwd(), 'reports'),
};

// Target currencies for international pricing
const TARGET_CURRENCIES = ['USD', 'GBP', 'CAD', 'AUD'];

// Currency to region mapping
const CURRENCY_TO_REGION = {
  'USD': 'US',
  'CAD': 'CA',
  'GBP': 'UK',
  'AUD': 'AU',
};

// ==================== STATE MANAGEMENT ====================
let syncState = {
  isRunning: false,
  startTime: null,
  lastUpdate: null,
  currentOffset: 0,
  totalProcessed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  errors: [],
  currentBatch: 0,
};

const ensureDirectories = () => {
  const dirs = [
    path.dirname(CONFIG.STATE_FILE),
    path.dirname(CONFIG.LOG_FILE),
    CONFIG.REPORT_DIR,
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

const saveState = () => {
  try {
    syncState.lastUpdate = new Date().toISOString();
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(syncState, null, 2));
  } catch (error) {
    console.error('Failed to save state:', error.message);
  }
};

const loadState = () => {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const data = fs.readFileSync(CONFIG.STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load state:', error.message);
  }
  return null;
};

const clearState = () => {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      fs.unlinkSync(CONFIG.STATE_FILE);
    }
  } catch (error) {
    console.error('Failed to clear state:', error.message);
  }
};

// ==================== LOGGING ====================
const logToFile = (message) => {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(CONFIG.LOG_FILE, logLine);
  } catch (error) {
    // Ignore file logging errors
  }
};

const log = (message, type = 'info') => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    'info': '📋',
    'success': '✅',
    'error': '❌',
    'warning': '⚠️',
    'progress': '🔄',
    'batch': '📦',
  }[type] || '📋';

  console.log(`[${timestamp}] ${prefix} ${message}`);
  logToFile(`[${type.toUpperCase()}] ${message}`);
};

// ==================== PRODUCT TRANSFORMATION ====================
const transformProduct = (product) => {
  const pricebookEntries = product.PricebookEntries?.records || [];

  // Get active pricebook entries with valid prices
  const activePricebookEntries = pricebookEntries.filter(entry =>
    entry.IsActive === true && entry.UnitPrice > 0
  );

  // Get USD price for base product
  const usdPrice = pricebookEntries.find(entry => entry.CurrencyIsoCode === 'USD' && entry.IsActive);
  const activePrice = pricebookEntries.find(entry => entry.IsActive);
  const defaultPrice = usdPrice?.UnitPrice || activePrice?.UnitPrice || pricebookEntries[0]?.UnitPrice || null;

  // Build international prices
  const internationalPrices = [];
  const regionalAvailability = new Set();

  // Process USD, GBP, CAD pricebook entries
  const nonAudCurrencies = ['USD', 'GBP', 'CAD'];
  const nonAudPricebookEntries = activePricebookEntries.filter(entry =>
    nonAudCurrencies.includes(entry.CurrencyIsoCode)
  );

  nonAudPricebookEntries.forEach(entry => {
    const pricebookName = entry.Pricebook2?.Name || 'Unknown';
    internationalPrices.push({
      currencyCode: entry.CurrencyIsoCode,
      price: entry.UnitPrice,
      pricebookName: pricebookName,
      region: CURRENCY_TO_REGION[entry.CurrencyIsoCode] || null,
      catalogId: null,
      catalogTitle: null,
      needsCatalogLookup: true,
    });

    if (CURRENCY_TO_REGION[entry.CurrencyIsoCode]) {
      regionalAvailability.add(CURRENCY_TO_REGION[entry.CurrencyIsoCode]);
    }
  });

  // Special handling for AUD: ONLY use "Standard Price" pricebook
  const standardPriceAUDEntry = activePricebookEntries.find(entry => {
    const pricebookName = (entry.Pricebook2?.Name || '').toLowerCase().trim();
    const isStandardPrice = pricebookName === 'standard price' ||
                            pricebookName === 'standard price book' ||
                            pricebookName === 'standard pricebook' ||
                            pricebookName.startsWith('standard price');
    return isStandardPrice && entry.CurrencyIsoCode === 'AUD';
  });

  if (standardPriceAUDEntry) {
    const pricebookName = standardPriceAUDEntry.Pricebook2?.Name || 'Standard Price';
    internationalPrices.push({
      currencyCode: 'AUD',
      price: standardPriceAUDEntry.UnitPrice,
      pricebookName: pricebookName,
      region: 'AU',
      catalogId: null,
      catalogTitle: null,
      needsCatalogLookup: true,
    });
    regionalAvailability.add('AU');
  }

  // Product fields
  const title = product.Web_Name__c || product.Name;
  const description = product.Description || product.SHOP_Description__c || '';
  const image = product.Common_Product_Image__c || product.Image__c || product.Product_Image__c;
  const status = product.View_in_eStore__c === true ? 'ACTIVE' : 'DRAFT';

  // Get base price (prefer Online-Store US)
  const onlineStoreUSEntry = activePricebookEntries.find(entry =>
    entry.Pricebook2?.Name?.toLowerCase() === 'online-store us' && entry.CurrencyIsoCode === 'USD'
  );
  const anyUSDEntry = activePricebookEntries.find(entry => entry.CurrencyIsoCode === 'USD');
  const price = onlineStoreUSEntry?.UnitPrice || anyUSDEntry?.UnitPrice || defaultPrice;

  const sku = product.ProductCode || '';
  const tags = product.SHOP_Meta_Tags__c || '';

  return {
    salesforceId: product.Id,
    productCode: product.ProductCode,
    sku: sku,
    family: product.Family,
    createdDate: product.CreatedDate,
    recordType: product.RecordType?.Name,
    title: title,
    description: description,
    price: price,
    image: image,
    status: status,
    tags: tags,
    sfName: product.Name,
    sfDescription: product.Description,
    productCompany: product.Product_Company__c,
    modelProductLine: product.Model_Product_Line__c,
    partType: product.Part_Type__c,
    modelText: product.SVMX_Model_Text__c,
    prices: pricebookEntries.map(entry => ({
      pricebookEntryId: entry.Id,
      unitPrice: entry.UnitPrice,
      pricebookId: entry.Pricebook2Id,
      pricebookName: entry.Pricebook2?.Name,
      currencyCode: entry.CurrencyIsoCode,
      isActive: entry.IsActive,
    })),
    internationalPrices: internationalPrices,
    regionalAvailability: [...regionalAvailability],
    weight: product.Weight__c,
    weightUnit: product.Weight_UM__c,
    metafields: {
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
    },
    ppcFlag: product.PPC_Flag__c,
    ppcDesc: product.PPC_Desc__c,
  };
};

// ==================== BATCH PROCESSING ====================
const processBatch = async (products, options) => {
  const { skipExisting, dryRun } = options;

  const results = {
    successful: [],
    failed: [],
    skipped: [],
    pricingResults: { successful: [], failed: [], skipped: [] },
  };

  if (dryRun) {
    log(`[DRY RUN] Would process ${products.length} products`, 'info');
    return {
      successful: products.map(p => ({ salesforceId: p.salesforceId, title: p.title, dryRun: true })),
      failed: [],
      skipped: [],
      pricingResults: { successful: [], failed: [], skipped: [] },
    };
  }

  // Create products in Shopify
  const shopifyResults = await createShopifyProductsBatch(products, CONFIG.DELAY_BETWEEN_PRODUCTS, skipExisting);

  results.successful = shopifyResults.successful || [];
  results.failed = shopifyResults.failed || [];
  results.skipped = shopifyResults.skipped || [];

  // Set international prices for successful products
  if (results.successful.length > 0) {
    const productsBySfId = {};
    for (const tp of products) {
      productsBySfId[tp.salesforceId] = tp;
    }

    for (const product of results.successful) {
      const transformedProduct = productsBySfId[product.salesforceId];
      const internationalPrices = transformedProduct?.internationalPrices || [];

      if (internationalPrices.length === 0) {
        results.pricingResults.skipped.push({
          salesforceId: product.salesforceId,
          title: product.title,
          reason: 'No international prices',
        });
        continue;
      }

      const variant = product.variants?.[0];
      if (!variant?.id) {
        results.pricingResults.failed.push({
          salesforceId: product.salesforceId,
          title: product.title,
          error: 'No variant ID found',
        });
        continue;
      }

      try {
        const priceResult = await setVariantInternationalPrices(variant.id, product.shopifyProductId, internationalPrices);

        if (priceResult.success) {
          results.pricingResults.successful.push({
            salesforceId: product.salesforceId,
            title: product.title,
            prices: priceResult.results.successful,
          });
        } else {
          results.pricingResults.failed.push({
            salesforceId: product.salesforceId,
            title: product.title,
            results: priceResult.results,
          });
        }
      } catch (error) {
        results.pricingResults.failed.push({
          salesforceId: product.salesforceId,
          title: product.title,
          error: error.message,
        });
      }

      // Small delay between pricing operations
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  return results;
};

// ==================== EXCEL REPORT GENERATION ====================
/**
 * Generates an Excel report for bulk sync results
 * @param {object} params - Report parameters
 * @param {array} params.allProducts - All processed products
 * @param {object} params.allResults - Combined results from all batches
 * @param {object} params.config - Sync configuration
 * @param {object} params.syncState - Current sync state
 * @returns {string} - Path to the generated report file
 */
const generateExcelReport = (params) => {
  const {
    allProducts,
    allResults,
    config,
    syncState: state,
  } = params;

  // Ensure reports directory exists
  if (!fs.existsSync(CONFIG.REPORT_DIR)) {
    fs.mkdirSync(CONFIG.REPORT_DIR, { recursive: true });
  }

  // Create maps for quick lookup of results
  const successfulMap = new Map();
  const failedMap = new Map();
  const skippedMap = new Map();

  // Map successful products
  (allResults.successful || []).forEach(p => {
    successfulMap.set(p.salesforceId, p);
  });

  // Map failed products
  (allResults.failed || []).forEach(p => {
    failedMap.set(p.salesforceId, p);
  });

  // Map skipped products
  (allResults.skipped || []).forEach(p => {
    skippedMap.set(p.salesforceId, p);
  });

  // Create pricing results map
  const pricingSuccessMap = new Map();
  const pricingFailedMap = new Map();
  (allResults.pricingResults?.successful || []).forEach(p => {
    const key = p.salesforceId || p.title;
    if (!pricingSuccessMap.has(key)) {
      pricingSuccessMap.set(key, []);
    }
    pricingSuccessMap.get(key).push(p);
  });
  (allResults.pricingResults?.failed || []).forEach(p => {
    const key = p.salesforceId || p.title;
    if (!pricingFailedMap.has(key)) {
      pricingFailedMap.set(key, []);
    }
    pricingFailedMap.get(key).push(p);
  });

  // Build report data
  const reportData = allProducts.map((product, index) => {
    const sfId = product.salesforceId;
    const isSuccessful = successfulMap.has(sfId);
    const isFailed = failedMap.has(sfId);
    const isSkipped = skippedMap.has(sfId);

    let status = 'Unknown';
    let shopifyProductId = '';
    let shopifyVariantId = '';
    let errorMessage = '';

    if (isSuccessful) {
      status = 'Created';
      const result = successfulMap.get(sfId);
      shopifyProductId = result.shopifyProductId || '';
      shopifyVariantId = result.variants?.[0]?.id || '';
    } else if (isSkipped) {
      status = 'Skipped (Already Exists)';
      const result = skippedMap.get(sfId);
      shopifyProductId = result.existingShopifyId || '';
      errorMessage = result.reason || '';
    } else if (isFailed) {
      status = 'Failed';
      const result = failedMap.get(sfId);
      errorMessage = JSON.stringify(result.errors || result.error || 'Unknown error');
    }

    // Get pricing status
    const pricingSuccess = pricingSuccessMap.get(sfId) || [];
    const pricingFailed = pricingFailedMap.get(sfId) || [];
    const pricingStatus = pricingSuccess.length > 0
      ? `Success (${pricingSuccess.length} catalogs)`
      : pricingFailed.length > 0
        ? `Failed (${pricingFailed.length} catalogs)`
        : 'N/A';

    // Get catalog assignments
    const catalogAssignments = pricingSuccess
      .flatMap(p => p.prices || [])
      .map(price => `${price.catalogTitle || 'Unknown'} (${price.currencyCode})`)
      .join(', ') || 'None';

    return {
      'Row #': index + 1,
      'Sync Status': status,
      'Salesforce ID': sfId,
      'Product Code / SKU': product.sku || product.productCode || '',
      'Product Name (Salesforce)': product.sfName || '',
      'Product Title (Shopify)': product.title || '',
      'Price (USD)': product.price || '',
      'Shopify Product ID': shopifyProductId,
      'Shopify Variant ID': shopifyVariantId,
      'Product Status': product.status || '',
      'PPC Flag': product.ppcFlag || '',
      'Family': product.family || '',
      'Product Company': product.productCompany || '',
      'Model': product.metafields?.model || '',
      'Model Product Line': product.metafields?.modelProductLine || '',
      'Weight': product.weight || '',
      'Weight Unit': product.weightUnit || '',
      'Regional Availability': (product.regionalAvailability || []).join(', ') || 'None',
      'International Pricing Status': pricingStatus,
      'Catalog Assignments': catalogAssignments,
      'International Prices': (product.internationalPrices || [])
        .map(p => `${p.pricebookName}: ${p.currencyCode} ${p.price}`)
        .join(' | ') || 'None',
      'Tags': product.tags || '',
      'Error Message': errorMessage,
      'Created Date (Salesforce)': product.createdDate || '',
    };
  });

  // Create summary sheet data
  const summaryData = [
    { 'Metric': 'Report Generated', 'Value': new Date().toISOString() },
    { 'Metric': 'Sync Start Time', 'Value': state.startTime || '' },
    { 'Metric': 'Sync End Time', 'Value': state.endTime || '' },
    { 'Metric': 'Batch Size', 'Value': config.batchSize || CONFIG.BATCH_SIZE },
    { 'Metric': 'Skip Existing', 'Value': config.skipExisting ? 'Yes' : 'No' },
    { 'Metric': 'Dry Run', 'Value': config.dryRun ? 'Yes' : 'No' },
    { 'Metric': 'Max Limit', 'Value': config.maxLimit === Infinity ? 'Unlimited' : config.maxLimit },
    { 'Metric': '', 'Value': '' },
    { 'Metric': 'Total Products Processed', 'Value': state.totalProcessed },
    { 'Metric': 'Successfully Created', 'Value': state.successful },
    { 'Metric': 'Failed', 'Value': state.failed },
    { 'Metric': 'Skipped (Already Exists)', 'Value': state.skipped },
    { 'Metric': '', 'Value': '' },
    { 'Metric': 'International Pricing - Successful', 'Value': allResults.pricingResults?.successful?.length || 0 },
    { 'Metric': 'International Pricing - Failed', 'Value': allResults.pricingResults?.failed?.length || 0 },
    { 'Metric': 'International Pricing - Skipped', 'Value': allResults.pricingResults?.skipped?.length || 0 },
  ];

  // Create workbook
  const workbook = xlsx.utils.book_new();

  // Add Summary sheet
  const summarySheet = xlsx.utils.json_to_sheet(summaryData);
  xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Add Products sheet
  const productsSheet = xlsx.utils.json_to_sheet(reportData);

  // Set column widths for better readability
  const colWidths = [
    { wch: 8 },   // Row #
    { wch: 22 },  // Sync Status
    { wch: 20 },  // Salesforce ID
    { wch: 18 },  // Product Code / SKU
    { wch: 40 },  // Product Name (Salesforce)
    { wch: 40 },  // Product Title (Shopify)
    { wch: 12 },  // Price (USD)
    { wch: 35 },  // Shopify Product ID
    { wch: 35 },  // Shopify Variant ID
    { wch: 12 },  // Product Status
    { wch: 18 },  // PPC Flag
    { wch: 15 },  // Family
    { wch: 20 },  // Product Company
    { wch: 20 },  // Model
    { wch: 25 },  // Model Product Line
    { wch: 10 },  // Weight
    { wch: 12 },  // Weight Unit
    { wch: 25 },  // Regional Availability
    { wch: 25 },  // International Pricing Status
    { wch: 50 },  // Catalog Assignments
    { wch: 60 },  // International Prices
    { wch: 30 },  // Tags
    { wch: 50 },  // Error Message
    { wch: 25 },  // Created Date
  ];
  productsSheet['!cols'] = colWidths;

  xlsx.utils.book_append_sheet(workbook, productsSheet, 'Products');

  // Add Failed Products sheet (if any)
  if (allResults.failed && allResults.failed.length > 0) {
    const failedData = allResults.failed.map((p, idx) => ({
      'Row #': idx + 1,
      'Salesforce ID': p.salesforceId || '',
      'Title': p.title || '',
      'SKU': p.sku || '',
      'Error': JSON.stringify(p.errors || p.error || 'Unknown'),
    }));
    const failedSheet = xlsx.utils.json_to_sheet(failedData);
    xlsx.utils.book_append_sheet(workbook, failedSheet, 'Failed Products');
  }

  // Add Skipped Products sheet (if any)
  if (allResults.skipped && allResults.skipped.length > 0) {
    const skippedData = allResults.skipped.map((p, idx) => ({
      'Row #': idx + 1,
      'Salesforce ID': p.salesforceId || '',
      'Title': p.title || '',
      'SKU': p.sku || '',
      'Existing Shopify ID': p.existingShopifyId || '',
      'Reason': p.reason || '',
    }));
    const skippedSheet = xlsx.utils.json_to_sheet(skippedData);
    xlsx.utils.book_append_sheet(workbook, skippedSheet, 'Skipped Products');
  }

  // Collect ALL errors for comprehensive Errors sheet
  const allErrors = [];

  // Add product creation errors
  (allResults.failed || []).forEach(p => {
    const errorDetails = p.errors || p.error || 'Unknown error';
    const errorMessage = typeof errorDetails === 'object'
      ? JSON.stringify(errorDetails)
      : String(errorDetails);

    allErrors.push({
      'Error Type': 'Product Creation',
      'Salesforce ID': p.salesforceId || '',
      'Product Name': p.title || '',
      'SKU': p.sku || '',
      'Error Category': 'Shopify API Error',
      'Error Message': errorMessage,
      'Error Details': typeof errorDetails === 'object'
        ? (errorDetails.map ? errorDetails.map(e => `${e.field || ''}: ${e.message || e}`).join('; ') : JSON.stringify(errorDetails))
        : errorMessage,
      'Timestamp': new Date().toISOString(),
    });
  });

  // Add pricing errors
  (allResults.pricingResults?.failed || []).forEach(p => {
    const errorDetails = p.results?.failed || p.errors || p.error || 'Unknown error';

    if (Array.isArray(errorDetails)) {
      errorDetails.forEach(err => {
        const errorMessage = err.errors
          ? (typeof err.errors === 'object' ? JSON.stringify(err.errors) : err.errors)
          : (err.error || 'Unknown');

        allErrors.push({
          'Error Type': 'International Pricing',
          'Salesforce ID': p.salesforceId || '',
          'Product Name': p.title || '',
          'SKU': '',
          'Error Category': `${err.pricebookName || 'Unknown'} - ${err.currencyCode || 'Unknown'}`,
          'Error Message': errorMessage,
          'Error Details': `Catalog: ${err.catalogTitle || err.catalogId || 'N/A'}, Price: ${err.price || 'N/A'}`,
          'Timestamp': new Date().toISOString(),
        });
      });
    } else {
      allErrors.push({
        'Error Type': 'International Pricing',
        'Salesforce ID': p.salesforceId || '',
        'Product Name': p.title || '',
        'SKU': '',
        'Error Category': 'Pricing Error',
        'Error Message': typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : String(errorDetails),
        'Error Details': '',
        'Timestamp': new Date().toISOString(),
      });
    }
  });

  // Add Errors sheet if there are any errors
  if (allErrors.length > 0) {
    const errorsSheet = xlsx.utils.json_to_sheet(allErrors);

    // Set column widths for errors sheet
    errorsSheet['!cols'] = [
      { wch: 20 },  // Error Type
      { wch: 20 },  // Salesforce ID
      { wch: 40 },  // Product Name
      { wch: 18 },  // SKU
      { wch: 30 },  // Error Category
      { wch: 60 },  // Error Message
      { wch: 50 },  // Error Details
      { wch: 25 },  // Timestamp
    ];

    xlsx.utils.book_append_sheet(workbook, errorsSheet, 'Errors');
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `bulk_sync_report_${timestamp}.xlsx`;
  const filepath = path.join(CONFIG.REPORT_DIR, filename);

  // Write file
  xlsx.writeFile(workbook, filepath);

  log(`Excel report generated: ${filepath}`, 'success');

  return {
    filepath,
    filename,
    reportDir: CONFIG.REPORT_DIR,
  };
};

// ==================== MAIN SYNC FUNCTION ====================
const runBulkSync = async (options) => {
  const {
    startOffset = 0,
    maxLimit = Infinity,
    batchSize = CONFIG.BATCH_SIZE,
    delayBetweenBatches = CONFIG.DELAY_BETWEEN_BATCHES,
    skipExisting = true,
    dryRun = false,
    resume = false,
  } = options;

  ensureDirectories();

  // Handle resume
  let offset = startOffset;
  if (resume) {
    const savedState = loadState();
    if (savedState && savedState.currentOffset > 0) {
      offset = savedState.currentOffset;
      log(`Resuming from offset ${offset} (previously processed ${savedState.totalProcessed} products)`, 'info');
    } else {
      log('No previous state found, starting fresh', 'warning');
    }
  } else {
    clearState();
  }

  // Initialize state
  syncState = {
    isRunning: true,
    startTime: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    currentOffset: offset,
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    currentBatch: 0,
    config: { batchSize, skipExisting, dryRun, maxLimit },
  };
  saveState();

  // Print banner
  console.log('\n' + '═'.repeat(70));
  console.log('  🚀 CANDELA BULK PRODUCT SYNC');
  console.log('═'.repeat(70));
  console.log(`  Start Offset:    ${offset}`);
  console.log(`  Batch Size:      ${batchSize}`);
  console.log(`  Skip Existing:   ${skipExisting}`);
  console.log(`  Dry Run:         ${dryRun}`);
  console.log(`  Max Products:    ${maxLimit === Infinity ? 'Unlimited' : maxLimit}`);
  console.log('═'.repeat(70) + '\n');

  // Ensure metafield definitions exist
  if (!dryRun) {
    log('Ensuring metafield definitions exist...', 'info');
    clearMetafieldDefinitionsCache();
    await ensureMetafieldDefinitions();
  }

  // Fetch initial info
  log('Fetching Shopify catalogs and price lists...', 'info');
  const catalogs = await getShopifyCatalogs();
  const priceLists = await getShopifyPriceLists();
  log(`Found ${catalogs.length} catalogs and ${priceLists.length} price lists`, 'success');

  let totalProcessed = 0;
  let batchNumber = Math.floor(offset / batchSize) + 1;
  const startTime = Date.now();

  // Collect all products and results for Excel report
  const allProducts = [];
  const allResults = {
    successful: [],
    failed: [],
    skipped: [],
    pricingResults: { successful: [], failed: [], skipped: [] },
  };

  // Main processing loop
  while (totalProcessed < maxLimit) {
    try {
      log(`\nBatch #${batchNumber} - Fetching from offset ${offset}...`, 'batch');

      // Calculate how many products to fetch (respect the limit)
      const remainingToProcess = maxLimit === Infinity ? batchSize : (maxLimit - totalProcessed);
      const fetchSize = Math.min(batchSize, remainingToProcess);

      if (fetchSize <= 0) {
        log('Reached product limit', 'success');
        break;
      }

      // Fetch products from Salesforce
      const salesforceProducts = await fetchSalesforceProducts(fetchSize, null, offset);

      if (salesforceProducts.length === 0) {
        log('No more products to process!', 'success');
        break;
      }

      log(`Fetched ${salesforceProducts.length} products from Salesforce`, 'info');

      // Trim to respect limit (in case Salesforce returned more than requested)
      const productsToProcess = maxLimit === Infinity
        ? salesforceProducts
        : salesforceProducts.slice(0, maxLimit - totalProcessed);

      if (productsToProcess.length < salesforceProducts.length) {
        log(`Trimmed to ${productsToProcess.length} products to respect --limit ${maxLimit}`, 'info');
      }

      // Transform products
      const transformedProducts = productsToProcess.map(transformProduct);

      // Process batch
      const results = await processBatch(transformedProducts, { skipExisting, dryRun });

      // Collect products and results for Excel report
      allProducts.push(...transformedProducts);
      allResults.successful.push(...(results.successful || []));
      allResults.failed.push(...(results.failed || []));
      allResults.skipped.push(...(results.skipped || []));
      allResults.pricingResults.successful.push(...(results.pricingResults?.successful || []));
      allResults.pricingResults.failed.push(...(results.pricingResults?.failed || []));
      allResults.pricingResults.skipped.push(...(results.pricingResults?.skipped || []));

      // Update counts
      const batchSuccessful = results.successful.length;
      const batchFailed = results.failed.length;
      const batchSkipped = results.skipped.length;

      syncState.successful += batchSuccessful;
      syncState.failed += batchFailed;
      syncState.skipped += batchSkipped;
      syncState.totalProcessed += productsToProcess.length;
      syncState.currentOffset = offset + productsToProcess.length;
      syncState.currentBatch = batchNumber;

      // Log errors
      if (results.failed.length > 0) {
        results.failed.forEach(f => {
          syncState.errors.push({
            batch: batchNumber,
            salesforceId: f.salesforceId,
            title: f.title,
            error: f.errors || f.error,
          });
        });
      }

      saveState();

      // Progress summary
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
      const rate = (syncState.totalProcessed / (elapsed || 1)).toFixed(1);

      log(`Batch #${batchNumber} complete: ✅ ${batchSuccessful} | ❌ ${batchFailed} | ⏭️ ${batchSkipped}`, 'progress');
      log(`Total: ${syncState.totalProcessed} processed | ${elapsed} min | ${rate} products/min`, 'info');

      // Check if we've reached the limit
      totalProcessed += productsToProcess.length;
      if (maxLimit !== Infinity && totalProcessed >= maxLimit) {
        log(`Reached maximum limit of ${maxLimit} products`, 'success');
        break;
      }

      // If we got fewer products than requested, we're done
      if (salesforceProducts.length < fetchSize) {
        log('Reached end of products!', 'success');
        break;
      }

      // Move to next batch
      offset += productsToProcess.length;
      batchNumber++;

      // Delay between batches
      log(`Waiting ${delayBetweenBatches}ms before next batch...`, 'info');
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));

    } catch (error) {
      log(`Batch #${batchNumber} error: ${error.message}`, 'error');
      logger.error('Bulk sync batch error', {
        batch: batchNumber,
        offset,
        error: error.message,
        stack: error.stack,
      });

      syncState.errors.push({
        batch: batchNumber,
        error: error.message,
        offset,
      });
      saveState();

      // Wait and try to continue
      log(`Waiting ${CONFIG.RETRY_DELAY}ms before continuing...`, 'warning');
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));

      // Skip this batch and continue
      offset += batchSize;
      batchNumber++;
    }
  }

  // Final summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  syncState.isRunning = false;
  syncState.endTime = new Date().toISOString();
  saveState();

  console.log('\n' + '═'.repeat(70));
  console.log('  🎉 BULK SYNC COMPLETED');
  console.log('═'.repeat(70));
  console.log(`  Total Products Processed: ${syncState.totalProcessed}`);
  console.log(`  Successful:               ${syncState.successful}`);
  console.log(`  Failed:                   ${syncState.failed}`);
  console.log(`  Skipped:                  ${syncState.skipped}`);
  console.log(`  Total Time:               ${totalTime} minutes`);
  console.log(`  Errors:                   ${syncState.errors.length}`);
  console.log('═'.repeat(70));
  console.log(`  State saved to: ${CONFIG.STATE_FILE}`);
  console.log(`  Log saved to:   ${CONFIG.LOG_FILE}`);
  console.log('═'.repeat(70) + '\n');

  // Write final JSON report (for state/resume purposes)
  const reportPath = path.join(CONFIG.REPORT_DIR, `bulk-sync-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(syncState, null, 2));
  log(`JSON report saved to: ${reportPath}`, 'success');

  // Generate Excel report (same format as API)
  if (allProducts.length > 0) {
    try {
      const excelReport = generateExcelReport({
        allProducts,
        allResults,
        config: { batchSize, skipExisting, dryRun, maxLimit },
        syncState,
      });
      console.log(`  Excel Report:     ${excelReport.filepath}`);
    } catch (excelError) {
      log(`Failed to generate Excel report: ${excelError.message}`, 'error');
    }
  }

  return syncState;
};

// ==================== CLI HANDLING ====================
const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    resume: false,
    startOffset: 0,
    maxLimit: Infinity,
    batchSize: CONFIG.BATCH_SIZE,
    delayBetweenBatches: CONFIG.DELAY_BETWEEN_BATCHES,
    skipExisting: true,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--resume':
      case '-r':
        options.resume = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-skip-existing':
        options.skipExisting = false;
        break;
      case '--skip-existing':
        options.skipExisting = true;
        break;
      case '--offset':
        options.startOffset = parseInt(args[++i], 10) || 0;
        break;
      case '--limit':
        options.maxLimit = parseInt(args[++i], 10) || Infinity;
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i], 10) || CONFIG.BATCH_SIZE;
        break;
      case '--delay':
        options.delayBetweenBatches = parseInt(args[++i], 10) || CONFIG.DELAY_BETWEEN_BATCHES;
        break;
    }
  }

  return options;
};

const showHelp = () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              CANDELA BULK PRODUCT SYNC SCRIPT                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  Syncs products from Salesforce to Shopify in batches                ║
╚══════════════════════════════════════════════════════════════════════╝

USAGE:
  node scripts/bulkSync.js [options]

OPTIONS:
  --help, -h          Show this help message
  --resume, -r        Resume from last saved position
  --offset N          Start from offset N (default: 0)
  --limit N           Maximum products to process (default: unlimited)
  --batch-size N      Products per batch (default: 50)
  --delay N           Delay between batches in ms (default: 2000)
  --skip-existing     Skip products that exist in Shopify (default)
  --no-skip-existing  Don't skip existing products (recreate all)
  --dry-run           Test mode - don't actually create products

EXAMPLES:
  # Start fresh sync of all products
  node scripts/bulkSync.js

  # Resume interrupted sync
  node scripts/bulkSync.js --resume

  # Sync first 1000 products only
  node scripts/bulkSync.js --limit 1000

  # Start from offset 5000
  node scripts/bulkSync.js --offset 5000

  # Use smaller batches (for rate limit issues)
  node scripts/bulkSync.js --batch-size 25 --delay 3000

  # Test run without creating products
  node scripts/bulkSync.js --dry-run --limit 10

  # Full sync with custom settings
  node scripts/bulkSync.js --batch-size 50 --delay 2000 --skip-existing

FILES:
  State:   ./data/sync-state.json    (progress tracking)
  Logs:    ./logs/bulk-sync.log      (detailed logs)
  Reports: ./reports/                (completion reports)
`);
};

// ==================== MAIN ENTRY POINT ====================
const main = async () => {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Check environment variables
  if (!process.env.STORE_URL || !process.env.STORE_TOKEN) {
    console.error('❌ Missing Shopify credentials. Set STORE_URL and STORE_TOKEN in .env');
    console.error('   STORE_URL:', process.env.STORE_URL ? '✓' : '✗');
    console.error('   STORE_TOKEN:', process.env.STORE_TOKEN ? '✓' : '✗');
    process.exit(1);
  }

  if (!process.env.SALESFORCE_LOGIN_URL || !process.env.SALESFORCE_USERNAME) {
    console.error('❌ Missing Salesforce credentials. Check your .env file.');
    console.error('   SALESFORCE_LOGIN_URL:', process.env.SALESFORCE_LOGIN_URL ? '✓' : '✗');
    console.error('   SALESFORCE_USERNAME:', process.env.SALESFORCE_USERNAME ? '✓' : '✗');
    console.error('   SALESFORCE_PASSWORD:', process.env.SALESFORCE_PASSWORD ? '✓' : '✗');
    console.error('   SALESFORCE_INSTANCE_URL:', process.env.SALESFORCE_INSTANCE_URL ? '✓' : '✗');
    process.exit(1);
  }

  try {
    await runBulkSync(options);
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    logger.error('Bulk sync fatal error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⚠️ Received SIGINT. Saving state and exiting...');
  syncState.isRunning = false;
  saveState();
  console.log('State saved. You can resume with: node scripts/bulkSync.js --resume');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️ Received SIGTERM. Saving state and exiting...');
  syncState.isRunning = false;
  saveState();
  process.exit(0);
});

// Run
main();
