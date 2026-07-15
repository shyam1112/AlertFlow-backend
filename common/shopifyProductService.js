import axios from 'axios';
import logger from './logger';

const STORE_URL = process.env.STORE_URL;
const STORE_TOKEN = process.env.STORE_TOKEN;
const API_VERSION = process.env.SHOPIFY_SYNC_API_VERSION || '2026-01';

/**
 * Makes a GraphQL call to Shopify Admin API
 */
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
      console.error('Shopify GraphQL errors:', response.data.errors);
      logger.error('Shopify GraphQL errors', { errors: response.data.errors });
      return { success: false, errors: response.data.errors };
    }

    return { success: true, data: response.data.data };
  } catch (error) {
    console.error('Shopify GraphQL request failed:', error.message);
    logger.error('Shopify GraphQL request failed', {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
};

/**
 * Metafield definitions for Salesforce product sync
 */
const METAFIELD_DEFINITIONS = [
  { key: 'model', name: 'Model', type: 'single_line_text_field' },
  { key: 'model_product_line', name: 'Model Product Line', type: 'single_line_text_field' },
  { key: 'qty_widget_type', name: 'Qty Widget Type', type: 'single_line_text_field' },
  { key: 'dimension_um', name: 'Dimension Unit of Measure', type: 'single_line_text_field' },
  { key: 'dim_length', name: 'Dimension Length', type: 'single_line_text_field' },
  { key: 'dim_width', name: 'Dimension Width', type: 'single_line_text_field' },
  { key: 'dim_height', name: 'Dimension Height', type: 'single_line_text_field' },
  { key: 'lot_size', name: 'Lot Size', type: 'single_line_text_field' },
  { key: 'user_manual_files_root', name: 'User Manual Files Root', type: 'single_line_text_field' },
  { key: 'special_offer', name: 'Special Offer', type: 'single_line_text_field' },
  { key: 'steps_for_widget', name: 'Steps for Widget', type: 'single_line_text_field' },
  { key: 'salesforce_product_id', name: 'Salesforce Product ID', type: 'single_line_text_field' },
  { key: 'ppc_flag', name: 'PPC Flag', type: 'single_line_text_field' },
  { key: 'salesforce_model_filter', name: 'Salesforce Model Filter', type: 'list.single_line_text_field' },
];

const METAFIELD_NAMESPACE = 'salesforce';

// Cache for existing metafield definitions to avoid repeated API calls
let metafieldDefinitionsCache = null;

/**
 * Fetches existing metafield definitions for PRODUCT owner type
 */
const getExistingMetafieldDefinitions = async () => {
  if (metafieldDefinitionsCache) {
    return metafieldDefinitionsCache;
  }

  const query = `
    query getMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: PRODUCT) {
        edges {
          node {
            id
            name
            namespace
            key
            type {
              name
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query);
  if (result.success) {
    const definitions = result.data.metafieldDefinitions.edges.map(edge => ({
      id: edge.node.id,
      name: edge.node.name,
      namespace: edge.node.namespace,
      key: edge.node.key,
      type: edge.node.type.name,
    }));
    metafieldDefinitionsCache = definitions;
    return definitions;
  }

  return [];
};

/**
 * Creates a metafield definition in Shopify
 */
const createMetafieldDefinition = async (definition) => {
  const mutation = `
    mutation createMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
          name
          namespace
          key
          type {
            name
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    definition: {
      name: definition.name,
      namespace: METAFIELD_NAMESPACE,
      key: definition.key,
      type: definition.type,
      ownerType: 'PRODUCT',
    },
  };

  console.log(`Creating metafield definition: ${METAFIELD_NAMESPACE}.${definition.key}`);

  const result = await shopifyGraphQL(mutation, variables);

  if (result.success) {
    const { createdDefinition, userErrors } = result.data.metafieldDefinitionCreate;

    if (userErrors && userErrors.length > 0) {
      console.error(`Failed to create metafield definition ${definition.key}:`, userErrors);
      return null;
    }

    console.log(`Created metafield definition: ${createdDefinition.namespace}.${createdDefinition.key}`);
    return createdDefinition;
  }

  return null;
};

/**
 * Ensures all required metafield definitions exist in Shopify
 * Creates missing definitions automatically
 */
export const ensureMetafieldDefinitions = async () => {
  console.log('Checking metafield definitions...');

  const existingDefinitions = await getExistingMetafieldDefinitions();
  console.log(`Found ${existingDefinitions.length} existing metafield definitions`);

  const createdDefinitions = [];

  for (const def of METAFIELD_DEFINITIONS) {
    // Check if definition already exists
    const exists = existingDefinitions.some(
      existing => existing.namespace === METAFIELD_NAMESPACE && existing.key === def.key
    );

    if (!exists) {
      console.log(`Metafield definition missing: ${METAFIELD_NAMESPACE}.${def.key}`);
      const created = await createMetafieldDefinition(def);
      if (created) {
        createdDefinitions.push(created);
        // Update cache
        if (metafieldDefinitionsCache) {
          metafieldDefinitionsCache.push({
            id: created.id,
            name: created.name,
            namespace: created.namespace,
            key: created.key,
            type: created.type.name,
          });
        }
      }
    } else {
      console.log(`Metafield definition exists: ${METAFIELD_NAMESPACE}.${def.key}`);
    }
  }

  if (createdDefinitions.length > 0) {
    console.log(`Created ${createdDefinitions.length} metafield definitions`);
  } else {
    console.log('All metafield definitions already exist');
  }

  return createdDefinitions;
};

/**
 * Clears the metafield definitions cache
 */
export const clearMetafieldDefinitionsCache = () => {
  metafieldDefinitionsCache = null;
  console.log('Metafield definitions cache cleared');
};

/**
 * Validates if a URL looks like a valid image URL
 */
const isValidImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  if (url.endsWith('/')) return false;

  // Check for common image extensions or Salesforce servlet URLs
  const validPatterns = [
    /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i,
    /\/servlet\//i,  // Salesforce servlet URLs
    /\/sfc\/servlet/i,  // Salesforce content servlet
    /\/file-asset\//i,  // Salesforce file assets
    /contentasset/i,  // Salesforce content assets
  ];

  return validPatterns.some(pattern => pattern.test(url));
};

/**
 * Extracts image URL from HTML img tag or returns URL as-is
 */
const extractImageUrl = (imageField) => {
  if (!imageField) return null;

  // Check if it's an HTML img tag - extract src attribute
  const srcMatch = imageField.match(/src=["']([^"']+)["']/);
  if (srcMatch && srcMatch[1]) {
    const url = srcMatch[1].trim();
    console.log(`  Extracted src from img tag: ${url}`);

    // Check if it's a valid image URL
    if (url && url.startsWith('http') && !url.endsWith('/')) {
      // Skip Salesforce internal URLs — they require authentication, Shopify can't fetch them
      if (url.includes('salesforce.com') || url.includes('force.com')) {
        console.log(`  URL skipped - Salesforce internal URL not accessible by Shopify: ${url.substring(0, 80)}`);
        return null;
      }
      if (isValidImageUrl(url)) {
        return url;
      }
      console.log(`  URL rejected - doesn't look like valid image URL: ${url}`);
    }
  }

  // Check if it's already a valid URL (not in img tag)
  if (imageField.startsWith('http') && !imageField.endsWith('/')) {
    // Skip Salesforce internal URLs
    if (imageField.includes('salesforce.com') || imageField.includes('force.com')) {
      console.log(`  URL skipped - Salesforce internal URL not accessible by Shopify`);
      return null;
    }
    if (isValidImageUrl(imageField)) {
      return imageField;
    }
  }

  return null;
};

/**
 * Creates a product in Shopify from Salesforce product data
 * Uses productSet mutation for API version 2025-01
 * @param {object} product - Transformed Salesforce product
 */
export const createShopifyProduct = async (product) => {
  try {
    const mutation = `
      mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
        productSet(input: $input, synchronous: $synchronous) {
          product {
            id
            title
            handle
            status
            tags
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryItem {
                    id
                    tracked
                    measurement {
                      weight {
                        value
                        unit
                      }
                    }
                  }
                }
              }
            }
            metafields(first: 20) {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Convert weight unit from Salesforce to Shopify format
    const getShopifyWeightUnit = (sfWeightUnit) => {
      if (!sfWeightUnit) return 'POUNDS';
      const unit = sfWeightUnit.toLowerCase();
      if (unit.includes('kg') || unit.includes('kilogram')) return 'KILOGRAMS';
      if (unit.includes('g') || unit.includes('gram')) return 'GRAMS';
      if (unit.includes('oz') || unit.includes('ounce')) return 'OUNCES';
      return 'POUNDS'; // default
    };

    // Parse tags from comma/semicolon separated string
    const parseTags = (tagsStr) => {
      if (!tagsStr) return [];
      return tagsStr.split(/[,;]/).map(t => t.trim()).filter(Boolean);
    };

    // Build product input for productSet
    const input = {
      title: product.title || product.sfName,
      descriptionHtml: product.description || '',
      vendor: product.productCompany || 'Candela',
      productType: product.partType || product.family || '',
      status: product.status || 'DRAFT', // Use status from transformation (based on View in eStore)
      tags: parseTags(product.tags), // Use tags from SHOP Meta Tags
      productOptions: [{
        name: 'Title',
        values: [{ name: 'Default Title' }],
      }],
      variants: [{
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        sku: product.sku || '',
        price: product.price ? String(product.price) : '0.00',
        taxable: true,
      }],
    };

    // Non-inventory PPC products: disable tracking + allow continue selling when out of stock
    const NON_INVENTORY_PPC_FLAGS = ['PPC - Non Inventory', 'PPC \u2013 Non Inventory'];
    const isNonInventory = NON_INVENTORY_PPC_FLAGS.includes(product.ppcFlag);
    input.variants[0].inventoryPolicy = isNonInventory ? 'CONTINUE' : 'DENY';

    input.variants[0].inventoryItem = {
      tracked: !isNonInventory,
      ...(product.weight && {
        measurement: {
          weight: {
            value: parseFloat(product.weight),
            unit: getShopifyWeightUnit(product.weightUnit),
          },
        },
      }),
    };

    // Build metafields array from product.metafields
    // Maps product.metafields keys to Shopify metafield keys
    const metafields = [];
    const metafieldKeyMapping = {
      model: 'model',
      modelProductLine: 'model_product_line',
      qtyWidgetType: 'qty_widget_type',
      dimensionUM: 'dimension_um',
      dimLength: 'dim_length',
      dimWidth: 'dim_width',
      dimHeight: 'dim_height',
      lotSize: 'lot_size',
      userManualFilesRoot: 'user_manual_files_root',
      specialOffer: 'special_offer',
      stepsForWidget: 'steps_for_widget',
      salesforceProductId: 'salesforce_product_id',
      ppcFlag: 'ppc_flag',
      salesforceModelFilter: 'salesforce_model_filter',
    };

    console.log('Product metafields input:', JSON.stringify(product.metafields, null, 2));

    if (product.metafields) {
      for (const [productKey, shopifyKey] of Object.entries(metafieldKeyMapping)) {
        const value = product.metafields[productKey];
        const definition = METAFIELD_DEFINITIONS.find(d => d.key === shopifyKey);

        if (!definition) continue;

        // Check for valid value (handle numbers including 0)
        const hasValue = value !== null && value !== undefined && value !== '' &&
          !(typeof value === 'number' && isNaN(value));
        console.log(`Metafield ${shopifyKey}: value="${value}", type="${typeof value}", hasValue=${hasValue}`);

        if (hasValue) {
          // single_line_text_field does not allow newline characters.
          // Strip \n and \r to prevent "Value must be a single line text string" errors.
          const sanitizedValue = String(value).replace(/[\r\n]+/g, ' ').trim();
          metafields.push({
            namespace: METAFIELD_NAMESPACE,
            key: shopifyKey,
            value: sanitizedValue,
            type: definition.type,
          });
        }
      }
    }

    // Add vertex.product_class from Tax_Category_Code__c (separate namespace from 'salesforce')
    if (product.metafields?.taxCategoryCode) {
      const sanitizedTaxCode = String(product.metafields.taxCategoryCode).replace(/[\r\n]+/g, ' ').trim();
      metafields.push({
        namespace: 'vertex',
        key: 'product_class',
        value: sanitizedTaxCode,
        type: 'single_line_text_field',
      });
      console.log(`Metafield vertex.product_class: "${sanitizedTaxCode}"`);
    }

    console.log('Metafields to create:', JSON.stringify(metafields, null, 2));

    // Add metafields to input if any exist
    if (metafields.length > 0) {
      input.metafields = metafields;
    }

    // Image upload skipped intentionally

    const variables = { input, synchronous: true };

    console.log(`Creating Shopify product: ${product.title || product.sfName}`);

    const result = await shopifyGraphQL(mutation, variables);

    if (!result.success) {
      return {
        success: false,
        salesforceId: product.salesforceId,
        title: product.title,
        errors: result.errors,
      };
    }

    const { productSet } = result.data;

    if (productSet.userErrors && productSet.userErrors.length > 0) {
      console.error(`Failed to create product "${product.title}":`, productSet.userErrors);
      return {
        success: false,
        salesforceId: product.salesforceId,
        title: product.title,
        errors: productSet.userErrors,
      };
    }

    console.log(`Created Shopify product: ${productSet.product.title} (${productSet.product.id})`);
    await publishProductToChannels(productSet.product.id);


    // Map variants with inventory item info
    const variants = productSet.product.variants.edges.map(e => ({
      id: e.node.id,
      sku: e.node.sku,
      price: e.node.price,
      weight: e.node.inventoryItem?.measurement?.weight?.value,
      weightUnit: e.node.inventoryItem?.measurement?.weight?.unit,
      inventoryItemId: e.node.inventoryItem?.id,
    }));

    // Map metafields
    const createdMetafields = productSet.product.metafields?.edges?.map(e => ({
      id: e.node.id,
      namespace: e.node.namespace,
      key: e.node.key,
      value: e.node.value,
    })) || [];

    return {
      success: true,
      salesforceId: product.salesforceId,
      shopifyProductId: productSet.product.id,
      title: productSet.product.title,
      handle: productSet.product.handle,
      status: productSet.product.status,
      tags: productSet.product.tags,
      variants: variants,
      metafields: createdMetafields,
    };
  } catch (error) {
    console.error(`Error creating Shopify product "${product.title}":`, error.message);
    logger.error('createShopifyProduct error', {
      salesforceId: product.salesforceId,
      title: product.title,
      message: error.message,
    });
    return {
      success: false,
      salesforceId: product.salesforceId,
      title: product.title,
      errors: [{ message: error.message }],
    };
  }
};

/**
 * Checks if a product already exists in Shopify by SKU
 * @param {string} sku - Product SKU to search for
 * @returns {object|null} - Existing product info or null if not found
 */
export const findExistingProductBySku = async (sku) => {
  try {
    if (!sku) return null;

    const query = `
      query findProductBySku($query: String!) {
        products(first: 1, query: $query) {
          edges {
            node {
              id
              title
              handle
              status
              variants(first: 1) {
                edges {
                  node {
                    id
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { query: `sku:${sku}` });

    if (!result.success || !result.data.products.edges.length) {
      return null;
    }

    const product = result.data.products.edges[0].node;
    const variant = product.variants.edges[0]?.node;

    // Verify SKU matches exactly (Shopify search can be fuzzy)
    if (variant?.sku === sku) {
      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        variantId: variant.id,
        sku: variant.sku,
      };
    }

    return null;
  } catch (error) {
    console.error(`Find existing product by SKU error:`, error.message);
    return null;
  }
};

/**
 * Checks multiple SKUs for existing products in Shopify
 * @param {array} skus - Array of SKUs to check
 * @returns {object} - Map of SKU to existing product info
 */
export const findExistingProductsBySkus = async (skus) => {
  const existingProducts = {};

  console.log(`\n🔍 Checking for existing products in Shopify (${skus.length} SKUs)...`);

  // Process in batches to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);

    // Check each SKU in parallel within the batch
    const results = await Promise.all(
      batch.map(async (sku) => {
        const existing = await findExistingProductBySku(sku);
        return { sku, existing };
      })
    );

    for (const { sku, existing } of results) {
      if (existing) {
        existingProducts[sku] = existing;
      }
    }

    // Progress log
    const checked = Math.min(i + batchSize, skus.length);
    const found = Object.keys(existingProducts).length;
    console.log(`   Checked ${checked}/${skus.length} SKUs, found ${found} existing products`);

    // Small delay between batches
    if (i + batchSize < skus.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`✅ Found ${Object.keys(existingProducts).length} existing products in Shopify\n`);
  return existingProducts;
};

/**
 * Creates multiple products in Shopify with rate limiting
 * Skips products that already exist (by SKU)
 * @param {array} products - Array of transformed Salesforce products
 * @param {number} delayMs - Delay between requests in ms (default 500ms)
 * @param {boolean} skipExisting - Whether to skip products that already exist (default true)
 */
export const createShopifyProductsBatch = async (products, delayMs = 500, skipExisting = true) => {
  const results = {
    successful: [],
    failed: [],
    skipped: [],
    total: products.length,
  };

  // Check for existing products if skipExisting is true
  let existingProducts = {};
  if (skipExisting) {
    const skus = products.map(p => p.sku).filter(Boolean);
    if (skus.length > 0) {
      existingProducts = await findExistingProductsBySkus(skus);
    }
  }

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(`\n[${i + 1}/${products.length}] Processing: "${product.title || product.sfName}" (SKU: ${product.sku || 'N/A'})`);

    // Check if product already exists — always process inactive products so their status is updated to DRAFT
    if (skipExisting && product.sku && existingProducts[product.sku] && product.isActive !== false) {
      const existing = existingProducts[product.sku];
      console.log(`   ⏭️ Skipping - Product already exists in Shopify: ${existing.title} (${existing.id})`);
      results.skipped.push({
        salesforceId: product.salesforceId,
        title: product.title,
        sku: product.sku,
        existingShopifyId: existing.id,
        existingShopifyTitle: existing.title,
        reason: 'Product already exists in Shopify',
      });
      continue;
    }

    if (skipExisting && product.sku && existingProducts[product.sku] && product.isActive === false) {
      console.log(`   ⚠️ Product exists but IsActive=false — updating status to DRAFT: ${product.title}`);
    }

    const result = await createShopifyProduct(product);

    if (result.success) {
      results.successful.push(result);
    } else {
      results.failed.push(result);
    }

    // Rate limiting - wait between requests
    if (i < products.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`\n📊 Batch complete:`);
  console.log(`   ✅ Successful: ${results.successful.length}`);
  console.log(`   ❌ Failed: ${results.failed.length}`);
  console.log(`   ⏭️ Skipped (existing): ${results.skipped.length}`);

  logger.info('Shopify product batch complete', {
    total: results.total,
    successful: results.successful.length,
    failed: results.failed.length,
    skipped: results.skipped.length,
  });

  return results;
};

// ==================== LOCATION MANAGEMENT ====================

// Cache for Shopify locations
let locationsCache = null;

/**
 * Fetches all locations from Shopify
 */
export const getShopifyLocations = async () => {
  try {
    if (locationsCache) {
      return locationsCache;
    }

    const query = `
      query {
        locations(first: 100) {
          edges {
            node {
              id
              name
              isActive
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    if (!result.success) {
      return [];
    }

    locationsCache = result.data.locations.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      isActive: e.node.isActive,
    }));

    console.log(`Fetched ${locationsCache.length} Shopify locations`);
    return locationsCache;
  } catch (error) {
    console.error('Get Shopify locations error:', error.message);
    return [];
  }
};

/**
 * Creates a new location in Shopify
 */
export const createShopifyLocation = async (locationName) => {
  try {
    const mutation = `
      mutation locationAdd($input: LocationAddInput!) {
        locationAdd(input: $input) {
          location {
            id
            name
            isActive
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      name: locationName,
      fulfillsOnlineOrders: true,
      address: {
        address1: locationName,
        city: 'Wayland',
        provinceCode: 'MA',
        countryCode: 'US',
        zip: '01778',
      },
    };

    console.log(`Creating Shopify location: ${locationName}`);
    const result = await shopifyGraphQL(mutation, { input });

    if (!result.success) {
      console.error(`Failed to create location "${locationName}":`, result.errors);
      return null;
    }

    const { locationAdd } = result.data;

    if (locationAdd.userErrors?.length > 0) {
      console.error(`Failed to create location "${locationName}":`, locationAdd.userErrors);
      return null;
    }

    const newLocation = {
      id: locationAdd.location.id,
      name: locationAdd.location.name,
      isActive: locationAdd.location.isActive,
    };

    // Add to cache
    if (locationsCache) {
      locationsCache.push(newLocation);
    }

    console.log(`Created Shopify location: ${locationName} (${newLocation.id})`);
    return newLocation;
  } catch (error) {
    console.error(`Create location error for "${locationName}":`, error.message);
    logger.error('Create Shopify location error', {
      locationName,
      message: error.message,
    });
    return null;
  }
};

/**
 * Finds a location by name or creates it if it doesn't exist
 */
export const findOrCreateLocation = async (locationName) => {
  try {
    const locations = await getShopifyLocations();

    // Find existing location (case-insensitive)
    const existing = locations.find(
      loc => loc.name.toLowerCase() === locationName.toLowerCase()
    );

    if (existing) {
      return existing;
    }

    // Create the location if it doesn't exist
    console.log(`Location "${locationName}" not found, creating...`);
    const newLocation = await createShopifyLocation(locationName);

    return newLocation;
  } catch (error) {
    console.error('Find or create location error:', error.message);
    return null;
  }
};

/**
 * Clears the locations cache
 */
export const clearLocationsCache = () => {
  locationsCache = null;
};

// ==================== INVENTORY MANAGEMENT ====================

/**
 * Enables inventory tracking for an inventory item
 */
export const enableInventoryTracking = async (inventoryItemId) => {
  try {
    const mutation = `
      mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem {
            id
            tracked
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, {
      id: inventoryItemId,
      input: { tracked: true },
    });

    if (!result.success) {
      console.error('Enable inventory tracking error:', result.errors);
      return { success: false, errors: result.errors };
    }

    const { inventoryItemUpdate } = result.data;

    if (inventoryItemUpdate.userErrors?.length > 0) {
      console.error('Enable inventory tracking userErrors:', inventoryItemUpdate.userErrors);
      return { success: false, errors: inventoryItemUpdate.userErrors };
    }

    console.log(`Enabled inventory tracking for ${inventoryItemId}`);
    return { success: true, tracked: inventoryItemUpdate.inventoryItem.tracked };
  } catch (error) {
    console.error('Enable inventory tracking error:', error.message);
    return { success: false, errors: [{ message: error.message }] };
  }
};

/**
 * Gets the inventory item ID for a variant
 */
export const getInventoryItemId = async (variantId) => {
  try {
    const query = `
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          id
          inventoryItem {
            id
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { id: variantId });

    if (!result.success || !result.data.productVariant) {
      return null;
    }

    return result.data.productVariant.inventoryItem.id;
  } catch (error) {
    console.error('Get inventory item ID error:', error.message);
    return null;
  }
};

/**
 * Activates inventory at a location for an inventory item
 */
export const activateInventoryAtLocation = async (inventoryItemId, locationId) => {
  try {
    const mutation = `
      mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
        inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
          inventoryLevel {
            id
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, { inventoryItemId, locationId });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    const { inventoryActivate } = result.data;

    if (inventoryActivate.userErrors?.length > 0) {
      return { success: false, errors: inventoryActivate.userErrors };
    }

    return { success: true, inventoryLevel: inventoryActivate.inventoryLevel };
  } catch (error) {
    console.error('Activate inventory at location error:', error.message);
    return { success: false, errors: [{ message: error.message }] };
  }
};

/**
 * Sets inventory quantity at a location
 */
export const setInventoryQuantity = async (inventoryItemId, locationId, quantity) => {
  try {
    const mutation = `
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
            changes {
              name
              delta
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      name: 'available',
      reason: 'correction',
      quantities: [{
        inventoryItemId,
        locationId,
        quantity: Math.floor(quantity), // Shopify requires integer
      }],
    };

    const result = await shopifyGraphQL(mutation, { input });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    const { inventorySetQuantities } = result.data;

    if (inventorySetQuantities.userErrors?.length > 0) {
      return { success: false, errors: inventorySetQuantities.userErrors };
    }

    return { success: true };
  } catch (error) {
    console.error('Set inventory quantity error:', error.message);
    return { success: false, errors: [{ message: error.message }] };
  }
};

/**
 * Sets inventory for a product variant at multiple locations
 * @param {string} variantId - Shopify variant GID
 * @param {array} stockData - Array of { locationName, quantity }
 * @param {string} existingInventoryItemId - Optional inventory item ID (skips lookup if provided)
 */
export const setVariantInventoryAtLocations = async (variantId, stockData, existingInventoryItemId = null) => {
  try {
    // Use provided inventory item ID or fetch it
    let inventoryItemId = existingInventoryItemId;
    if (!inventoryItemId) {
      inventoryItemId = await getInventoryItemId(variantId);
    }

    if (!inventoryItemId) {
      return { success: false, error: 'Could not get inventory item ID' };
    }

    // Enable inventory tracking first
    console.log(`Enabling inventory tracking for ${inventoryItemId}...`);
    const trackingResult = await enableInventoryTracking(inventoryItemId);
    if (!trackingResult.success) {
      console.error('Failed to enable inventory tracking:', trackingResult.errors);
      // Continue anyway, might already be enabled
    }

    const results = {
      successful: [],
      failed: [],
      skipped: [],
    };

    for (const stock of stockData) {
      const location = await findOrCreateLocation(stock.locationName);

      if (!location) {
        results.skipped.push({
          locationName: stock.locationName,
          reason: 'Could not find or create location in Shopify',
        });
        continue;
      }

      // First activate inventory at this location
      const activateResult = await activateInventoryAtLocation(inventoryItemId, location.id);
      if (!activateResult.success) {
        // May already be activated, try to set quantity anyway
        console.log(`Inventory may already be active at ${stock.locationName}`);
      }

      // Set the quantity
      console.log(`Setting inventory at ${stock.locationName}: ${stock.quantity}`);
      const setResult = await setInventoryQuantity(
        inventoryItemId,
        location.id,
        stock.quantity
      );

      if (setResult.success) {
        results.successful.push({
          locationName: stock.locationName,
          locationId: location.id,
          quantity: stock.quantity,
        });
        console.log(`Set inventory at ${stock.locationName}: ${stock.quantity}`);
      } else {
        results.failed.push({
          locationName: stock.locationName,
          errors: setResult.errors,
        });
      }

      // Small delay between inventory operations
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return {
      success: results.failed.length === 0,
      results,
    };
  } catch (error) {
    console.error('Set variant inventory at locations error:', error.message);
    return { success: false, error: error.message };
  }
};

// ==================== MARKET & INTERNATIONAL PRICING ====================

// Country to currency mapping for target markets
const MARKET_CONFIG = {
  US: { countryCode: 'US', currencyCode: 'USD', name: 'United States' },
  CA: { countryCode: 'CA', currencyCode: 'CAD', name: 'Canada' },
  GB: { countryCode: 'GB', currencyCode: 'GBP', name: 'United Kingdom' },
  AU: { countryCode: 'AU', currencyCode: 'AUD', name: 'Australia' },
  NZ: { countryCode: 'NZ', currencyCode: 'NZD', name: 'New Zealand' },
};

// Cache for markets
let marketsCache = null;

/**
 * Gets all markets from Shopify
 */
export const getShopifyMarkets = async () => {
  try {
    if (marketsCache) {
      return marketsCache;
    }

    const query = `
      query {
        markets(first: 50) {
          edges {
            node {
              id
              name
              handle
              enabled
              primary
              regions(first: 50) {
                edges {
                  node {
                    ... on MarketRegionCountry {
                      id
                      code
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    if (!result.success) {
      console.error('Failed to fetch markets:', result.errors);
      return [];
    }

    marketsCache = result.data.markets.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      handle: e.node.handle,
      enabled: e.node.enabled,
      primary: e.node.primary,
      countries: e.node.regions.edges.map(r => ({
        id: r.node.id,
        code: r.node.code,
        name: r.node.name,
      })),
    }));

    console.log(`Fetched ${marketsCache.length} Shopify markets`);
    return marketsCache;
  } catch (error) {
    console.error('Get Shopify markets error:', error.message);
    return [];
  }
};

/**
 * Finds a market that contains a specific country
 */
export const findMarketByCountry = async (countryCode) => {
  const markets = await getShopifyMarkets();
  return markets.find(m => m.countries.some(c => c.code === countryCode));
};

/**
 * Creates a new market for a country
 */
export const createMarket = async (countryCode, marketName) => {
  try {
    const mutation = `
      mutation marketCreate($input: MarketCreateInput!) {
        marketCreate(input: $input) {
          market {
            id
            name
            handle
            enabled
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      name: marketName,
      enabled: true,
      regions: [{
        countryCode: countryCode,
      }],
    };

    console.log(`Creating market for ${marketName} (${countryCode})...`);
    const result = await shopifyGraphQL(mutation, { input });

    if (!result.success) {
      console.error(`Failed to create market for ${countryCode}:`, result.errors);
      return null;
    }

    const { marketCreate } = result.data;

    if (marketCreate.userErrors?.length > 0) {
      console.error(`Failed to create market for ${countryCode}:`, marketCreate.userErrors);
      return null;
    }

    // Clear cache
    marketsCache = null;

    console.log(`Created market: ${marketCreate.market.name} (${marketCreate.market.id})`);
    return {
      id: marketCreate.market.id,
      name: marketCreate.market.name,
      handle: marketCreate.market.handle,
      enabled: marketCreate.market.enabled,
    };
  } catch (error) {
    console.error(`Create market error for ${countryCode}:`, error.message);
    return null;
  }
};

/**
 * Finds or creates a market for a country
 */
export const findOrCreateMarket = async (countryCode) => {
  const config = MARKET_CONFIG[countryCode];
  if (!config) {
    console.error(`Unknown country code: ${countryCode}`);
    return null;
  }

  // Check if market exists
  const existingMarket = await findMarketByCountry(countryCode);
  if (existingMarket) {
    return existingMarket;
  }

  // Create new market
  return await createMarket(countryCode, config.name);
};

// Cache for catalogs
let catalogsCache = null;

/**
 * Clears the catalogs cache
 */
export const clearCatalogsCache = () => {
  catalogsCache = null;
  console.log('Catalogs cache cleared');
};

/**
 * Gets catalogs (price lists) for the shop
 * @param {boolean} forceRefresh - Force refresh the cache
 */
export const getShopifyCatalogs = async (forceRefresh = false) => {
  try {
    // Return cached if available and not forcing refresh
    if (catalogsCache && !forceRefresh) {
      return catalogsCache;
    }

    // Fetch up to 250 catalogs to ensure we get all
    const query = `
      query {
        catalogs(first: 250) {
          edges {
            node {
              id
              title
              status
              ... on MarketCatalog {
                markets(first: 10) {
                  edges {
                    node {
                      id
                      name
                    }
                  }
                }
              }
              ... on CompanyLocationCatalog {
                companyLocations(first: 10) {
                  edges {
                    node {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    if (!result.success) {
      return catalogsCache || [];
    }

    catalogsCache = result.data.catalogs.edges.map(e => ({
      id: e.node.id,
      title: e.node.title,
      status: e.node.status,
      markets: e.node.markets?.edges?.map(m => m.node) || [],
      companyLocations: e.node.companyLocations?.edges?.map(cl => cl.node) || [],
    }));

    console.log(`📚 Fetched ${catalogsCache.length} catalogs from Shopify`);
    return catalogsCache;
  } catch (error) {
    console.error('Get catalogs error:', error.message);
    return catalogsCache || [];
  }
};

/**
 * Sets a fixed price for a product variant in a specific market/country
 * Uses priceListFixedPricesAdd mutation
 */
export const setMarketPrice = async (priceListId, variantId, price, currencyCode) => {
  try {
    const mutation = `
      mutation priceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
        priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
          prices {
            variant {
              id
            }
            price {
              amount
              currencyCode
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const prices = [{
      variantId: variantId,
      price: {
        amount: String(price),
        currencyCode: currencyCode,
      },
    }];

    const result = await shopifyGraphQL(mutation, { priceListId, prices });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    const { priceListFixedPricesAdd } = result.data;

    if (priceListFixedPricesAdd.userErrors?.length > 0) {
      return { success: false, errors: priceListFixedPricesAdd.userErrors };
    }

    return { success: true, prices: priceListFixedPricesAdd.prices };
  } catch (error) {
    console.error('Set market price error:', error.message);
    return { success: false, errors: [{ message: error.message }] };
  }
};

/**
 * Gets price lists from Shopify
 */
export const getShopifyPriceLists = async () => {
  try {
    const query = `
      query getPriceLists($after: String) {
        priceLists(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              currency
              catalog {
                id
                title
              }
            }
          }
        }
      }
    `;

    const allPriceLists = [];
    let cursor = null;

    do {
      const result = await shopifyGraphQL(query, { after: cursor });
      if (!result.success) break;

      const { edges, pageInfo } = result.data.priceLists;
      allPriceLists.push(...edges.map(e => ({
        id: e.node.id,
        name: e.node.name,
        currency: e.node.currency,
        catalogId: e.node.catalog?.id,
        catalogTitle: e.node.catalog?.title,
      })));

      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor);

    return allPriceLists;
  } catch (error) {
    console.error('Get price lists error:', error.message);
    return [];
  }
};

/**
 * Creates a price list for a catalog
 */
export const createPriceList = async (name, currencyCode, catalogId) => {
  try {
    const mutation = `
      mutation priceListCreate($input: PriceListCreateInput!) {
        priceListCreate(input: $input) {
          priceList {
            id
            name
            currency
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      name: name,
      currency: currencyCode,
      parent: {
        adjustment: {
          type: 'PERCENTAGE_DECREASE',
          value: 0,
        },
      },
      catalogId: catalogId,
    };

    console.log(`Creating price list: ${name} (${currencyCode})...`);
    const result = await shopifyGraphQL(mutation, { input });

    if (!result.success) {
      console.error(`Failed to create price list:`, result.errors);
      return null;
    }

    const { priceListCreate } = result.data;

    if (priceListCreate.userErrors?.length > 0) {
      console.error(`Failed to create price list:`, priceListCreate.userErrors);
      return null;
    }

    console.log(`Created price list: ${priceListCreate.priceList.name}`);
    return {
      id: priceListCreate.priceList.id,
      name: priceListCreate.priceList.name,
      currency: priceListCreate.priceList.currency,
    };
  } catch (error) {
    console.error('Create price list error:', error.message);
    return null;
  }
};

/**
 * Gets price list for a specific catalog
 */
export const getPriceListForCatalog = async (catalogId) => {
  try {
    const priceLists = await getShopifyPriceLists();
    return priceLists.find(pl => pl.catalogId === catalogId) || null;
  } catch (error) {
    console.error('Get price list for catalog error:', error.message);
    return null;
  }
};

// Cache for company locations
let companyLocationsCache = null;

/**
 * Gets company locations from Shopify (for B2B catalogs)
 * Company locations are required for creating proper CompanyLocationCatalogs
 */
const getCompanyLocations = async () => {
  try {
    if (companyLocationsCache) {
      return companyLocationsCache;
    }

    const query = `
      query {
        companyLocations(first: 50) {
          edges {
            node {
              id
              name
              company {
                id
                name
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    if (!result.success) {
      console.log('   No company locations found or B2B not enabled');
      return [];
    }

    companyLocationsCache = result.data.companyLocations?.edges?.map(e => ({
      id: e.node.id,
      name: e.node.name,
      companyId: e.node.company?.id,
      companyName: e.node.company?.name,
    })) || [];

    console.log(`   Found ${companyLocationsCache.length} company locations`);
    return companyLocationsCache;
  } catch (error) {
    console.log(`   Company locations query failed: ${error.message}`);
    return [];
  }
};

/**
 * Clears company locations cache
 */
export const clearCompanyLocationsCache = () => {
  companyLocationsCache = null;
};

/**
 * Updates a publication to enable manual product selection (disable auto-publish)
 * This allows include/exclude specific products instead of "include all products"
 * @param {string} publicationId - Publication GID
 */
const setPublicationManualSelection = async (publicationId) => {
  try {
    const mutation = `
      mutation publicationUpdate($id: ID!, $input: PublicationUpdateInput!) {
        publicationUpdate(id: $id, input: $input) {
          publication {
            id
            name
            autoPublish
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, {
      id: publicationId,
      input: {
        autoPublish: false, // Disable auto-publish = manual product selection
      },
    });

    if (!result.success) {
      console.error(`Failed to update publication ${publicationId}:`, result.errors);
      return false;
    }

    const { publicationUpdate } = result.data;

    if (publicationUpdate.userErrors?.length > 0) {
      console.error(`Failed to update publication:`, publicationUpdate.userErrors);
      return false;
    }

    console.log(`   ✅ Publication set to manual selection (autoPublish: ${publicationUpdate.publication.autoPublish})`);
    return true;
  } catch (error) {
    console.error(`Set publication manual selection error:`, error.message);
    return false;
  }
};

/**
 * Gets the publication ID for a catalog
 * @param {string} catalogId - Catalog GID
 */
const getCatalogPublicationId = async (catalogId) => {
  try {
    const query = `
      query getCatalogPublication($id: ID!) {
        catalog(id: $id) {
          id
          title
          publication {
            id
            name
            autoPublish
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { id: catalogId });

    if (!result.success || !result.data?.catalog) {
      console.error(`Failed to get catalog publication:`, result.errors);
      return null;
    }

    return result.data.catalog.publication?.id || null;
  } catch (error) {
    console.error(`Get catalog publication error:`, error.message);
    return null;
  }
};

/**
 * Creates a publication for a catalog with manual product selection enabled
 * Uses defaultState: 'EMPTY' to enable include/exclude options in Shopify admin
 * @param {string} catalogId - Catalog GID
 * @returns {object|null} - Publication info or null if failed
 */
const createPublicationForCatalog = async (catalogId) => {
  try {
    console.log(`   📰 Creating publication for catalog ${catalogId}...`);
    const mutation = `
      mutation CreatePublication($input: PublicationCreateInput!) {
        publicationCreate(input: $input) {
          publication {
            id
            name
            autoPublish
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, {
      input: {
        catalogId: catalogId,
        defaultState: 'EMPTY', // Start with no products (enables include/exclude options)
        autoPublish: false, // Manual product selection
      },
    });

    if (!result.success) {
      console.error(`   ❌ Failed to create publication:`, result.errors);
      return null;
    }

    const { publicationCreate } = result.data;

    if (publicationCreate.userErrors?.length > 0) {
      console.error(`   ❌ Publication creation errors:`, publicationCreate.userErrors);
      return null;
    }

    const publication = publicationCreate.publication;
    console.log(`   ✅ Created publication: ${publication.name} (${publication.id}), autoPublish: ${publication.autoPublish}`);
    return publication;
  } catch (error) {
    console.error(`   ❌ Create publication error:`, error.message);
    return null;
  }
};

/**
 * Creates a new Catalog in Shopify with manual product selection enabled
 * Tries multiple approaches to create a working catalog
 * Automatically creates a publication if the catalog doesn't have one
 * @param {string} title - Catalog title (pricebook name)
 */
export const createCatalog = async (title) => {
  try {
    console.log(`🆕 Creating new catalog: "${title}"...`);

    // First, try to get company locations to properly create B2B catalog
    const companyLocations = await getCompanyLocations();

    const mutation = `
      mutation catalogCreate($input: CatalogCreateInput!) {
        catalogCreate(input: $input) {
          catalog {
            id
            title
            status
            priceList {
              id
              name
              currency
            }
            publication {
              id
              name
              autoPublish
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    // Build input - include company location if available for proper B2B catalog
    const input = {
      title: title,
      status: 'ACTIVE',
      context: {
        companyLocationIds: []
      }
    };

    // // If we have company locations, create a proper CompanyLocationCatalog
    // if (companyLocations && companyLocations.length > 0) {
    //   console.log(`   Found ${companyLocations.length} company locations, creating B2B catalog...`);
    //   input.context = {
    //     companyLocationIds: [companyLocations[0].id], // Use first company location
    //   };
    // } else {
    //   console.log(`   No company locations found, creating catalog without B2B context...`);
    //   // Don't include context - let Shopify decide the catalog type
    // }

    const result = await shopifyGraphQL(mutation, { input });

    if (!result.success) {
      console.error(`Failed to create catalog "${title}":`, result.errors);
      console.log(`⚠️ Please create the catalog "${title}" manually in Shopify admin.`);
      return null;
    }

    const { catalogCreate } = result.data;

    if (catalogCreate.userErrors?.length > 0) {
      console.error(`Failed to create catalog "${title}":`, catalogCreate.userErrors);
      // Check if it's a "catalog already exists" error
      const alreadyExistsError = catalogCreate.userErrors.some(e =>
        e.message.toLowerCase().includes('already exists') ||
        e.message.toLowerCase().includes('duplicate') ||
        e.message.toLowerCase().includes('has already been taken') ||
        e.message.toLowerCase().includes('already been taken')
      );
      if (alreadyExistsError) {
        console.log(`   🔄 Catalog "${title}" already exists. Will retry search with fresh data.`);
        return { alreadyExists: true, title };
      } else {
        console.log(`⚠️ Please create the catalog "${title}" manually in Shopify admin.`);
      }
      return null;
    }

    const catalog = catalogCreate.catalog;
    console.log(`✅ Created catalog: "${catalog.title}" (${catalog.id})`);

    // Set publication to manual product selection (disable auto-publish)
    // This enables "Include specific products" option in Shopify admin
    const publicationId = catalog.publication?.id;
    if (publicationId) {
      console.log(`   📋 Configuring catalog for manual product selection...`);
      console.log(`   Publication ID: ${publicationId}, Current autoPublish: ${catalog.publication?.autoPublish}`);

      if (catalog.publication?.autoPublish !== false) {
        const updateResult = await setPublicationManualSelection(publicationId);
        if (updateResult) {
          console.log(`   ✅ Publication set to manual selection (Include specific products)`);
        }
      } else {
        console.log(`   ✅ Publication already set to manual selection`);
      }
    } else {
      // ==================== AUTO-CREATE PUBLICATION IF MISSING ====================
      // Catalog created without publication - create one automatically
      console.log(`   ⚠️ Catalog has no publication - creating one automatically...`);
      const newPublication = await createPublicationForCatalog(catalog.id);
      if (newPublication) {
        console.log(`   ✅ Created publication for new catalog: ${newPublication.id}`);
        return {
          id: catalog.id,
          title: catalog.title,
          status: catalog.status,
          publicationId: newPublication.id,
          priceListId: catalog.priceList?.id,
        };
      } else {
        console.log(`   ⚠️ Could not create publication - product inclusion may fail`);
      }
      // ==================== END AUTO-CREATE PUBLICATION ====================
    }

    return {
      id: catalog.id,
      title: catalog.title,
      status: catalog.status,
      publicationId: publicationId,
      priceListId: catalog.priceList?.id,
    };
  } catch (error) {
    console.error(`Create catalog error for "${title}":`, error.message);
    console.log(`⚠️ Please create the catalog "${title}" manually in Shopify admin.`);
    return null;
  }
};

/**
 * Gets detailed information about a catalog including its publication
 * Useful for diagnosing catalog issues
 * @param {string} catalogId - Catalog GID
 */
export const getCatalogDetails = async (catalogId) => {
  try {
    const query = `
      query getCatalogDetails($id: ID!) {
        catalog(id: $id) {
          id
          title
          status
          ... on CompanyLocationCatalog {
            companyLocations(first: 10) {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
          priceList {
            id
            name
            currency
          }
          publication {
            id
            name
            autoPublish
            products(first: 5) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { id: catalogId });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    const catalog = result.data.catalog;
    if (!catalog) {
      return { success: false, error: 'Catalog not found' };
    }

    const details = {
      id: catalog.id,
      title: catalog.title,
      status: catalog.status,
      type: catalog.id.includes('MarketCatalog') ? 'MarketCatalog' :
        catalog.id.includes('CompanyLocationCatalog') ? 'CompanyLocationCatalog' :
          catalog.id.includes('AppCatalog') ? 'AppCatalog' : 'Unknown',
      companyLocations: catalog.companyLocations?.edges?.map(e => ({
        id: e.node.id,
        name: e.node.name,
      })) || [],
      priceList: catalog.priceList ? {
        id: catalog.priceList.id,
        name: catalog.priceList.name,
        currency: catalog.priceList.currency,
      } : null,
      publication: catalog.publication ? {
        id: catalog.publication.id,
        name: catalog.publication.name,
        autoPublish: catalog.publication.autoPublish,
        productCount: catalog.publication.products?.edges?.length || 0,
      } : null,
      hasPublication: !!catalog.publication,
      isManualSelection: catalog.publication?.autoPublish === false,
    };

    console.log(`\n📋 Catalog Details: "${details.title}"`);
    console.log(`   ID: ${details.id}`);
    console.log(`   Type: ${details.type}`);
    console.log(`   Status: ${details.status}`);
    console.log(`   Company Locations: ${details.companyLocations.length > 0 ? details.companyLocations.map(c => c.name).join(', ') : 'None'}`);
    console.log(`   Price List: ${details.priceList ? `${details.priceList.name} (${details.priceList.currency})` : 'None'}`);
    console.log(`   Publication: ${details.hasPublication ? details.publication.name : 'None'}`);
    console.log(`   Auto Publish: ${details.publication?.autoPublish}`);
    console.log(`   Manual Selection: ${details.isManualSelection ? 'Yes (Include specific products)' : 'No (Include all products)'}`);

    return { success: true, details };
  } catch (error) {
    console.error(`Get catalog details error:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Updates an existing catalog to enable manual product selection
 * Use this to fix catalogs that were created with "include all products"
 * @param {string} catalogId - Catalog GID
 */
export const setCatalogManualProductSelection = async (catalogId) => {
  try {
    console.log(`🔧 Setting catalog ${catalogId} to manual product selection...`);

    const publicationId = await getCatalogPublicationId(catalogId);

    if (!publicationId) {
      console.error(`   ❌ Catalog has no publication`);
      // Try to create a publication for this catalog (matching the curl mutation provided)
      try {
        console.log(`   Attempting to create publication for catalog ${catalogId}...`);
        const mutation = `
          mutation publicationCreate($input: PublicationCreateInput!) {
            publicationCreate(input: $input) {
              publication {
                id
                name
                autoPublish
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          input: {
            catalogId: catalogId,
            defaultState: 'EMPTY', // Start with no products (enables include/exclude options)
            autoPublish: false, // Manual product selection
          },
        };

        const createResult = await shopifyGraphQL(mutation, variables);

        if (!createResult.success) {
          console.error(`   Failed to create publication for ${catalogId}:`, createResult.errors);
          return { success: false, error: 'Catalog has no publication and creation failed', details: createResult.errors };
        }

        const { publicationCreate } = createResult.data;
        if (publicationCreate.userErrors?.length > 0) {
          console.error(`   Publication creation user errors:`, publicationCreate.userErrors);
          return { success: false, error: 'Publication creation returned userErrors', details: publicationCreate.userErrors };
        }

        const newPublicationId = publicationCreate.publication?.id || null;
        if (!newPublicationId) {
          console.error(`   Publication created but no id returned for ${catalogId}`);
          return { success: false, error: 'Publication created but no id returned' };
        }

        console.log(`   ✅ Created publication ${newPublicationId} for catalog ${catalogId}`);

        // Ensure publication is set to manual selection (autoPublish: false)
        const setResult = await setPublicationManualSelection(newPublicationId);
        if (setResult) {
          console.log(`   ✅ Catalog now uses manual product selection`);
          return { success: true, catalogId, publicationId: newPublicationId };
        }

        return { success: false, error: 'Failed to set manual selection after creating publication' };
      } catch (innerErr) {
        console.error(`   Error creating publication for ${catalogId}:`, innerErr.message || innerErr);
        return { success: false, error: innerErr.message || String(innerErr) };
      }
    }

    const success = await setPublicationManualSelection(publicationId);

    if (success) {
      console.log(`   ✅ Catalog now uses manual product selection`);
      return { success: true, catalogId, publicationId };
    } else {
      return { success: false, error: 'Failed to update publication' };
    }
  } catch (error) {
    console.error(`Set catalog manual selection error:`, error.message);
    return { success: false, error: error.message };
  }
};



/**
 * Updates ALL existing catalogs to enable manual product selection
 * Use this to fix all catalogs that were created with "include all products"
 * @returns {object} Results with successful and failed catalogs
 */
export const setAllCatalogsManualProductSelection = async () => {
  try {
    console.log(`\n🔧 Setting ALL catalogs to manual product selection...`);

    // Fetch all catalogs
    const catalogs = await getShopifyCatalogs(true); // Force refresh

    if (catalogs.length === 0) {
      console.log(`   No catalogs found`);
      return { success: true, message: 'No catalogs found', results: { successful: [], failed: [] } };
    }

    console.log(`   Found ${catalogs.length} catalogs to update`);

    const results = {
      successful: [],
      failed: [],
      skipped: [],
    };

    for (const catalog of catalogs) {
      console.log(`\n   Processing: "${catalog.title}" (${catalog.id})`);

      // Skip MarketCatalogs - they use different product selection mechanism
      if (catalog.id.includes('MarketCatalog')) {
        console.log(`   ⏭️ Skipping MarketCatalog - uses market-based product selection`);
        results.skipped.push({
          catalogId: catalog.id,
          title: catalog.title,
          reason: 'MarketCatalog uses market-based selection',
        });
        continue;
      }

      const result = await setCatalogManualProductSelection(catalog.id);

      if (result.success) {
        results.successful.push({
          catalogId: catalog.id,
          title: catalog.title,
          publicationId: result.publicationId,
        });
      } else {
        results.failed.push({
          catalogId: catalog.id,
          title: catalog.title,
          error: result.error,
        });
      }

      // Small delay between updates
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`\n📊 Manual selection update complete:`);
    console.log(`   ✅ Successful: ${results.successful.length}`);
    console.log(`   ❌ Failed: ${results.failed.length}`);
    console.log(`   ⏭️ Skipped: ${results.skipped.length}`);

    return {
      success: results.failed.length === 0,
      results,
    };
  } catch (error) {
    console.error(`Set all catalogs manual selection error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Cache for catalogs (separate from getShopifyCatalogs to allow clearing)
let catalogsSearchCache = null;

/**
 * Clears the catalogs search cache
 */
export const clearCatalogsSearchCache = () => {
  catalogsSearchCache = null;
};

/**
 * Checks if B2B is available on the store
 * B2B is required for creating CompanyLocationCatalogs
 */
export const isB2BAvailable = async () => {
  try {
    const companyLocations = await getCompanyLocations();
    // If we can query company locations and get results, B2B is likely available
    // Even if empty, the query succeeding means B2B feature is accessible
    return companyLocations !== null;
  } catch (error) {
    return false;
  }
};

/**
 * Gets or creates a price list for a Market
 * Used when B2B is not available - uses Markets for regional pricing
 * @param {string} currencyCode - Currency code
 */
export const getOrCreateMarketPriceList = async (currencyCode) => {
  try {
    console.log(`\n📊 Getting/Creating Market price list for ${currencyCode}...`);

    // Currency to country mapping
    const currencyToCountry = {
      'USD': 'US',
      'CAD': 'CA',
      'GBP': 'GB',
      'AUD': 'AU',
      'NZD': 'NZ',
    };

    const countryCode = currencyToCountry[currencyCode];
    if (!countryCode) {
      console.log(`   ❌ Unknown currency: ${currencyCode}`);
      return null;
    }

    // Check existing price lists first
    const priceLists = await getShopifyPriceLists();
    const existingPriceList = priceLists.find(pl => pl.currency === currencyCode);

    if (existingPriceList) {
      console.log(`   ✅ Found existing price list: ${existingPriceList.name} (${existingPriceList.id})`);
      return {
        priceListId: existingPriceList.id,
        priceListName: existingPriceList.name,
        currency: existingPriceList.currency,
        source: 'existing',
      };
    }

    // Find or create Market for this country
    let market = await findMarketByCountry(countryCode);

    if (!market) {
      console.log(`   Creating market for ${countryCode}...`);
      market = await createMarket(countryCode, MARKET_CONFIG[countryCode]?.name || countryCode);
      if (!market) {
        console.log(`   ❌ Failed to create market for ${countryCode}`);
        return null;
      }
    }

    console.log(`   Found/created market: ${market.name} (${market.id})`);

    // Create price list for this market
    // Note: In Shopify, Markets can have currency settings but price lists need to be attached to catalogs
    // For non-B2B, we'll create a standalone price list
    const priceListName = `${market.name} Prices`;

    const mutation = `
      mutation priceListCreate($input: PriceListCreateInput!) {
        priceListCreate(input: $input) {
          priceList {
            id
            name
            currency
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const input = {
      name: priceListName,
      currency: currencyCode,
      parent: {
        adjustment: {
          type: "PERCENTAGE_DECREASE",
          value: 0
        }
      },
    };

    const result = await shopifyGraphQL(mutation, { input });

    if (!result.success) {
      console.log(`   ❌ Failed to create price list:`, result.errors);
      return null;
    }

    const { priceListCreate } = result.data;

    if (priceListCreate.userErrors?.length > 0) {
      // Check if price list already exists
      const alreadyExists = priceListCreate.userErrors.some(e =>
        e.message.toLowerCase().includes('already') ||
        e.code === 'TAKEN'
      );

      if (alreadyExists) {
        // Try to find the existing one
        const refreshedPriceLists = await getShopifyPriceLists();
        const existingOne = refreshedPriceLists.find(pl => pl.currency === currencyCode);
        if (existingOne) {
          return {
            priceListId: existingOne.id,
            priceListName: existingOne.name,
            currency: existingOne.currency,
            source: 'existing',
          };
        }
      }

      console.log(`   ❌ Price list creation error:`, priceListCreate.userErrors);
      return null;
    }

    console.log(`   ✅ Created price list: ${priceListCreate.priceList.name}`);
    return {
      priceListId: priceListCreate.priceList.id,
      priceListName: priceListCreate.priceList.name,
      currency: priceListCreate.priceList.currency,
      marketId: market.id,
      marketName: market.name,
      source: 'created',
    };
  } catch (error) {
    console.error(`Get/Create market price list error:`, error.message);
    return null;
  }
};

/**
 * Finds a catalog by title and currency
 * Catalog title format: "Pricebook Name - CURRENCY" (e.g., "NA Inside Sales Price Book - CAD")
 * @param {string} title - Base catalog title (pricebook name)
 * @param {string} currencyCode - Currency code (USD, GBP, CAD, AUD)
 * @param {boolean} forceRefresh - Force refresh catalogs cache
 * @returns {object|null} - Catalog info with priceListId if found
 */
export const findCatalogByTitleAndCurrency = async (title, currencyCode, forceRefresh = false) => {
  try {
    // Catalog title format: "Pricebook Name - CURRENCY"
    const catalogTitle = `${title} - ${currencyCode}`;
    console.log(`\n🔍 Looking for catalog: "${catalogTitle}"${forceRefresh ? ' (force refresh)' : ''}`);

    // Clear cache if force refresh
    if (forceRefresh) {
      catalogsSearchCache = null;
      clearCatalogsCache(); // Also clear the main catalogs cache
    }

    // Get all catalogs (with fresh fetch if needed)
    const catalogs = await getShopifyCatalogs(forceRefresh);
    // Get all price lists
    const priceLists = await getShopifyPriceLists();

    console.log(`   Available catalogs (${catalogs.length}): ${catalogs.slice(0, 10).map(c => `"${c.title}"`).join(', ')}${catalogs.length > 10 ? '...' : ''}`);

    // Find catalog with matching title (case-insensitive, flexible matching)
    // Try exact match first
    let matchingCatalog = catalogs.find(c =>
      c.title.toLowerCase().trim() === catalogTitle.toLowerCase().trim()
    );

    // If no exact match, try contains match (in case of slight variations)
    if (!matchingCatalog) {
      matchingCatalog = catalogs.find(c =>
        c.title.toLowerCase().trim().includes(catalogTitle.toLowerCase().trim()) ||
        catalogTitle.toLowerCase().trim().includes(c.title.toLowerCase().trim())
      );
      if (matchingCatalog) {
        console.log(`   ⚠️ No exact match, but found similar catalog: "${matchingCatalog.title}"`);
      }
    }

    if (!matchingCatalog) {
      console.log(`   ❌ No catalog found with title "${catalogTitle}"`);
      return null;
    }

    console.log(`   ✅ Found catalog: "${matchingCatalog.title}" (${matchingCatalog.id})`);

    // Find price list for this catalog with matching currency
    const priceList = priceLists.find(pl =>
      pl.catalogId === matchingCatalog.id && pl.currency === currencyCode
    );

    if (priceList) {
      console.log(`   ✅ Found ${currencyCode} price list (${priceList.id})`);
      return {
        id: matchingCatalog.id,
        title: matchingCatalog.title,
        status: matchingCatalog.status,
        priceListId: priceList.id,
        priceListCurrency: priceList.currency,
      };
    }

    // Catalog exists but no price list with matching currency
    console.log(`   ⚠️ Catalog found but no ${currencyCode} price list. Will create one.`);
    return {
      id: matchingCatalog.id,
      title: matchingCatalog.title,
      status: matchingCatalog.status,
      priceListId: null,
      priceListCurrency: null,
    };
  } catch (error) {
    console.error(`Find catalog by title and currency error:`, error.message);
    return null;
  }
};

/**
 * Finds or creates a catalog by title and ensures it has a price list with the specified currency
 * Falls back to using Market price lists if B2B catalogs are not available
 * Catalog title format: "Pricebook Name - CURRENCY" (e.g., "NA Inside Sales Price Book - CAD")
 * @param {string} title - Base catalog title (pricebook name)
 * @param {string} currencyCode - Currency code (USD, GBP, CAD, AUD)
 * @returns {object|null} - Catalog/PriceList info with priceListId
 */
export const findOrCreateCatalogWithPriceList = async (title, currencyCode) => {
  try {
    // Catalog title format: "Pricebook Name - CURRENCY"
    const catalogTitle = `${title} - ${currencyCode}`;
    console.log(`\n📦 Finding or creating catalog: "${catalogTitle}"`);

    // First, try to find existing catalog
    let catalogInfo = await findCatalogByTitleAndCurrency(title, currencyCode);

    // If no catalog found, try to create one
    if (!catalogInfo) {
      console.log(`   Creating new catalog "${catalogTitle}"...`);
      const newCatalog = await createCatalog(catalogTitle);

      // Check if it's an "already exists" response or null (creation failed)
      const needsRetry = !newCatalog || newCatalog.alreadyExists;

      if (needsRetry) {
        // Creation failed or catalog already exists - clear ALL caches and retry search
        console.log(`   ⚠️ ${newCatalog?.alreadyExists ? 'Catalog already exists' : 'Creation failed'}, clearing all caches and retrying search...`);
        clearCatalogsSearchCache();
        clearCatalogsCache();

        // Wait a moment for any eventual consistency
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try to find the catalog again with force refresh
        catalogInfo = await findCatalogByTitleAndCurrency(title, currencyCode, true);

        if (!catalogInfo) {
          // Still can't find B2B catalog - fall back to Market-based price list
          console.log(`   ⚠️ B2B catalog not available, falling back to Market price list...`);
          const marketPriceList = await getOrCreateMarketPriceList(currencyCode);

          if (marketPriceList) {
            console.log(`   ✅ Using Market price list: ${marketPriceList.priceListName} (${marketPriceList.priceListId})`);
            return {
              id: null, // No catalog ID for market-based pricing
              title: `Market: ${marketPriceList.marketName || currencyCode}`,
              status: 'ACTIVE',
              priceListId: marketPriceList.priceListId,
              priceListCurrency: marketPriceList.currency,
              isMarketBased: true, // Flag to indicate this is not a B2B catalog
            };
          }

          // Last resort - try to find any catalog with matching title
          console.log(`   ⚠️ Market price list also failed, searching for any matching catalog...`);
          const catalogs = await getShopifyCatalogs();
          const priceLists = await getShopifyPriceLists();

          // Try to find any catalog that contains the title
          const possibleMatch = catalogs.find(c =>
            c.title.toLowerCase().includes(title.toLowerCase()) ||
            title.toLowerCase().includes(c.title.toLowerCase())
          );

          if (possibleMatch) {
            console.log(`   ✅ Found possible match: "${possibleMatch.title}" (${possibleMatch.id})`);
            const priceList = priceLists.find(pl =>
              pl.catalogId === possibleMatch.id && pl.currency === currencyCode
            );
            catalogInfo = {
              id: possibleMatch.id,
              title: possibleMatch.title,
              status: possibleMatch.status,
              priceListId: priceList?.id || null,
              priceListCurrency: priceList?.currency || null,
            };
          } else {
            // No catalog found at all - use standalone price list if available
            const standalonePriceList = priceLists.find(pl => pl.currency === currencyCode);
            if (standalonePriceList) {
              console.log(`   ✅ Using standalone price list: ${standalonePriceList.name}`);
              return {
                id: null,
                title: standalonePriceList.name,
                status: 'ACTIVE',
                priceListId: standalonePriceList.id,
                priceListCurrency: standalonePriceList.currency,
                isMarketBased: true,
              };
            }

            console.error(`   ❌ Failed to find or create catalog/price list for "${catalogTitle}"`);
            console.log(`   ℹ️ Available catalogs: ${catalogs.map(c => `"${c.title}"`).join(', ') || 'None'}`);
            console.log(`   ℹ️ Available price lists: ${priceLists.map(pl => `"${pl.name} (${pl.currency})"`).join(', ') || 'None'}`);
            console.log(`   ℹ️ Note: B2B catalogs require Shopify Plus with B2B enabled.`);
            return null;
          }
        }
      } else {
        catalogInfo = {
          id: newCatalog.id,
          title: newCatalog.title,
          status: newCatalog.status,
          priceListId: newCatalog.priceListId || null,
          priceListCurrency: null,
        };
      }
    }

    // If catalog doesn't have a price list with matching currency, create one
    if (catalogInfo && !catalogInfo.priceListId) {
      console.log(`   Creating price list for "${catalogInfo.title}" with currency ${currencyCode}...`);
      const newPriceList = await createPriceList(
        `${catalogInfo.title} Prices`,
        currencyCode,
        catalogInfo.id
      );
      if (newPriceList) {
        catalogInfo.priceListId = newPriceList.id;
        catalogInfo.priceListCurrency = newPriceList.currency;
        console.log(`   ✅ Created price list: ${newPriceList.name} (${newPriceList.id})`);
      } else {
        // Price list creation failed ("already assigned") — fetch all price lists fresh
        // and look for the one actually linked to this specific catalog
        console.log(`   ⚠️ Price list creation failed, searching for catalog-linked price list...`);
        const priceLists = await getShopifyPriceLists();
        const existingPriceList = priceLists.find(pl =>
          pl.catalogId === catalogInfo.id && pl.currency === currencyCode
        );
        if (existingPriceList) {
          catalogInfo.priceListId = existingPriceList.id;
          catalogInfo.priceListCurrency = existingPriceList.currency;
          console.log(`   ✅ Found catalog-linked price list: ${existingPriceList.name} (${existingPriceList.id})`);
        } else {
          // Try any price list linked to this catalog (any currency) — catalog is fixed, currency should match
          const anyCatalogPriceList = priceLists.find(pl => pl.catalogId === catalogInfo.id);
          if (anyCatalogPriceList) {
            catalogInfo.priceListId = anyCatalogPriceList.id;
            catalogInfo.priceListCurrency = anyCatalogPriceList.currency;
            console.log(`   ✅ Found catalog-linked price list (different currency): ${anyCatalogPriceList.name} (${anyCatalogPriceList.id})`);
          } else {
            // No price list found linked to this catalog — cannot set price safely
            console.error(`   ❌ No price list found for catalog "${catalogInfo.title}" — skipping to avoid setting wrong price`);
            return null;
          }
        }
      }
    }

    if (catalogInfo) {
      console.log(`   ✅ Ready: "${catalogInfo.title}" with ${currencyCode} price list (${catalogInfo.priceListId})`);
    }
    return catalogInfo;
  } catch (error) {
    console.error(`Find or create catalog error:`, error.message);
    return null;
  }
};

/**
 * Sets price for a variant in a specific catalog
 * @param {string} catalogId - Shopify catalog GID (e.g., gid://shopify/CompanyLocationCatalog/87300243513)
 * @param {string} variantId - Shopify variant GID
 * @param {number} price - Price amount
 * @param {string} currencyCode - Currency code (USD, CAD, etc.)
 */
export const setVariantPriceInCatalog = async (catalogId, variantId, price, currencyCode) => {
  try {
    console.log(`Setting price in catalog ${catalogId} for variant ${variantId}: ${currencyCode} ${price}`);

    // Get all price lists and find one for this catalog WITH matching currency
    const priceLists = await getShopifyPriceLists();
    let priceList = priceLists.find(pl => pl.catalogId === catalogId && pl.currency === currencyCode);

    // If no price list with matching currency exists for this catalog
    if (!priceList) {
      // Check if there's any price list for this catalog (might have different currency)
      const existingPriceList = priceLists.find(pl => pl.catalogId === catalogId);

      if (existingPriceList) {
        // Catalog already has a price list with different currency
        // Shopify only allows ONE price list per catalog, so we can't create another
        console.warn(`⚠️ Catalog ${catalogId} has a price list with ${existingPriceList.currency} currency, but trying to set ${currencyCode} price.`);
        console.warn(`   Shopify only allows one price list per catalog. Please fix the currency in Shopify admin.`);
        console.warn(`   Falling back to currency-based price list...`);

        // Fall back to finding a price list by currency (not catalog-specific)
        priceList = priceLists.find(pl => pl.currency === currencyCode && !pl.catalogId);

        if (!priceList) {
          // Try to find any price list with matching currency
          priceList = priceLists.find(pl => pl.currency === currencyCode);
        }

        if (!priceList) {
          return {
            success: false,
            error: `Catalog has wrong currency (${existingPriceList.currency}) and no fallback ${currencyCode} price list found`,
          };
        }

        console.log(`   Using fallback price list: ${priceList.name} (${priceList.id})`);
      } else {
        // No price list exists for this catalog, create one
        console.log(`No price list found for catalog ${catalogId}, creating one for ${currencyCode}...`);
        const catalogName = catalogId.split('/').pop();
        priceList = await createPriceList(`Catalog ${catalogName} ${currencyCode} Prices`, currencyCode, catalogId);

        if (!priceList) {
          return { success: false, error: `Failed to create ${currencyCode} price list for catalog` };
        }
      }
    }

    // Set the price
    const result = await setMarketPrice(priceList.id, variantId, price, currencyCode);

    if (result.success) {
      console.log(`✅ Set ${currencyCode} ${price} in catalog ${catalogId}`);
    } else {
      console.error(`❌ Failed to set price in catalog:`, result.errors);
    }

    return result;
  } catch (error) {
    console.error('Set variant price in catalog error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Adds/includes a product in a catalog
 * Handles both MarketCatalog and AppCatalog types
 * Automatically creates a publication if the catalog doesn't have one
 * @param {string} catalogId - Shopify catalog GID
 * @param {string} productId - Shopify product GID
 */
export const addProductToCatalog = async (catalogId, productId) => {
  try {
    console.log(`\n📦 Adding product ${productId} to catalog ${catalogId}...`);

    // Determine catalog type from GID
    const catalogType = catalogId.includes('MarketCatalog') ? 'MarketCatalog' :
      catalogId.includes('AppCatalog') ? 'AppCatalog' :
        catalogId.includes('CompanyLocationCatalog') ? 'CompanyLocationCatalog' : 'Unknown';
    console.log(`   Catalog type: ${catalogType}`);

    // Get the catalog's publication ID
    const catalogQuery = `
      query getCatalog($id: ID!) {
        catalog(id: $id) {
          id
          title
          status
          publication {
            id
            name
          }
        }
      }
    `;

    const catalogResult = await shopifyGraphQL(catalogQuery, { id: catalogId });
    console.log(`   Catalog query result:`, JSON.stringify(catalogResult.data?.catalog || catalogResult.errors, null, 2));

    if (!catalogResult.success || !catalogResult.data?.catalog) {
      console.error(`   ❌ Failed to get catalog ${catalogId}:`, catalogResult.errors);
      return { success: false, error: 'Catalog not found' };
    }

    const catalog = catalogResult.data.catalog;
    let publicationId = catalog.publication?.id;

    console.log(`   Catalog title: ${catalog.title}`);
    console.log(`   Catalog status: ${catalog.status}`);
    console.log(`   Publication ID: ${publicationId || 'None'}`);

    // ==================== AUTO-CREATE PUBLICATION IF MISSING ====================
    // This integrates the fix-catalogs logic into the productSync flow
    if (!publicationId) {
      console.warn(`   ⚠️ Catalog ${catalogId} has no publication - creating one automatically...`);

      // Try to create a publication for this catalog
      const newPublication = await createPublicationForCatalog(catalogId);

      if (newPublication) {
        publicationId = newPublication.id;
        console.log(`   ✅ Publication created successfully: ${publicationId}`);
      } else {
        // Publication creation failed - try alternative method
        console.log(`   ⚠️ Publication creation failed, trying alternative method...`);

        // For catalogs without direct publication, try using productPublish mutation
        const productPublishMutation = `
          mutation productPublish($input: ProductPublishInput!) {
            productPublish(input: $input) {
              product {
                id
                title
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        // Get all publications for the shop
        const pubQuery = `
          query {
            publications(first: 50) {
              edges {
                node {
                  id
                  name
                  catalog {
                    id
                    title
                  }
                }
              }
            }
          }
        `;

        const pubResult = await shopifyGraphQL(pubQuery);
        if (pubResult.success) {
          console.log(`   Available publications:`);
          const publications = pubResult.data.publications.edges.map(e => e.node);
          publications.forEach(p => {
            console.log(`     - ${p.name} (${p.id}) → Catalog: ${p.catalog?.title || 'None'}`);
          });

          // Find publication for this catalog
          const matchingPub = publications.find(p => p.catalog?.id === catalogId);
          if (matchingPub) {
            console.log(`   Found matching publication: ${matchingPub.name}`);

            const publishResult = await shopifyGraphQL(productPublishMutation, {
              input: {
                id: productId,
                productPublications: [{ publicationId: matchingPub.id }],
              },
            });

            if (publishResult.success && !publishResult.data.productPublish?.userErrors?.length) {
              console.log(`   ✅ Added product to catalog via productPublish`);
              return { success: true };
            } else {
              console.error(`   ❌ productPublish failed:`, publishResult.data?.productPublish?.userErrors || publishResult.errors);
            }
          }
        }

        return { success: false, error: 'Catalog has no publication and could not create one' };
      }
    }
    // ==================== END AUTO-CREATE PUBLICATION ====================

    // Publish the product to the catalog's publication
    const mutation = `
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            ... on Product {
              id
              title
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: productId,
      input: [{
        publicationId: publicationId,
      }],
    };

    console.log(`   Publishing product to publication ${publicationId}...`);
    const result = await shopifyGraphQL(mutation, variables);

    if (!result.success) {
      console.error(`   ❌ Failed to add product to catalog:`, result.errors);
      return { success: false, errors: result.errors };
    }

    const { publishablePublish } = result.data;

    if (publishablePublish?.userErrors?.length > 0) {
      console.error(`   ❌ Failed to add product to catalog:`, publishablePublish.userErrors);
      return { success: false, errors: publishablePublish.userErrors };
    }

    console.log(`   ✅ Added product to catalog ${catalog.title}`);
    return { success: true };
  } catch (error) {
    console.error('   ❌ Add product to catalog error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Sets international prices for a product variant based on Salesforce price data
 * Now supports catalog-specific pricing from Online-Store pricebooks
 * @param {string} variantId - Shopify variant GID
 * @param {string} productId - Shopify product GID (needed for catalog inclusion)
 * @param {array} priceData - Array of { currencyCode, price, catalogId, pricebookName } from Salesforce
 */
export const setVariantInternationalPrices = async (variantId, productId, priceData) => {
  try {
    const results = {
      successful: [],
      failed: [],
      skipped: [],
    };

    // Track which catalogs we've already added the product to (avoid duplicates)
    const processedCatalogs = new Set();

    // Get existing price lists
    const priceLists = await getShopifyPriceLists();

    // Filter prices for target countries only
    const targetCurrencies = Object.values(MARKET_CONFIG).map(c => c.currencyCode);

    console.log(`\n💰 Setting international prices for variant ${variantId}`);
    console.log(`   Product ID: ${productId}`);
    console.log(`   Price entries to process: ${priceData.length}`);
    console.log(`   Price entries: ${JSON.stringify(priceData.map(p => ({ currency: p.currencyCode, price: p.price, pricebook: p.pricebookName, catalogId: p.catalogId?.substring(0, 50) })), null, 2)}`);

    for (const priceEntry of priceData) {
      const { currencyCode, price, catalogId, catalogTitle, pricebookName, needsCatalogLookup } = priceEntry;
      console.log(`\n   Processing: ${pricebookName} - ${currencyCode} ${price} → Catalog: ${catalogTitle || 'none'} (${catalogId || 'no ID'})${needsCatalogLookup ? ' [NEEDS CATALOG LOOKUP]' : ''}`);

      // Skip if not a target currency
      if (!targetCurrencies.includes(currencyCode)) {
        results.skipped.push({
          currencyCode,
          pricebookName,
          reason: 'Not a target market currency',
        });
        continue;
      }

      // Skip only if price is null/undefined (not for $0 prices — valid for non-inventory items)
      if (price === null || price === undefined) {
        results.skipped.push({
          currencyCode,
          pricebookName,
          reason: 'Price is null',
        });
        continue;
      }

      // ==================== DYNAMIC CATALOG LOOKUP ====================
      // If needsCatalogLookup is true, find/create catalog by pricebook name + currency
      if (needsCatalogLookup && pricebookName) {
        console.log(`   🔄 Dynamic catalog lookup for: "${pricebookName}" with ${currencyCode}`);

        // Find or create catalog with matching title and currency
        const catalogInfo = await findOrCreateCatalogWithPriceList(pricebookName, currencyCode);

        if (!catalogInfo) {
          results.failed.push({
            currencyCode,
            price,
            pricebookName,
            errors: `Failed to find/create catalog "${pricebookName}" with ${currencyCode}`,
          });
          console.log(`   ❌ Failed to find/create catalog for ${pricebookName}`);
          continue;
        }

        console.log(`   ✅ Got catalog: "${catalogInfo.title}" (${catalogInfo.id}) with price list ${catalogInfo.priceListId}`);

        // Set price using the price list
        const setResult = await setMarketPrice(catalogInfo.priceListId, variantId, price, currencyCode);

        if (setResult.success) {
          // Add product to catalog (only once per catalog)
          if (productId && !processedCatalogs.has(catalogInfo.id)) {
            console.log(`   📦 Adding product to catalog "${catalogInfo.title}"...`);
            const includeResult = await addProductToCatalog(catalogInfo.id, productId);
            if (includeResult.success) {
              processedCatalogs.add(catalogInfo.id);
              console.log(`   📦 ✅ Successfully added product to catalog`);
            } else {
              console.warn(`   📦 ⚠️ Price set but failed to include product in catalog: ${JSON.stringify(includeResult.error || includeResult.errors)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 300));
          } else if (processedCatalogs.has(catalogInfo.id)) {
            console.log(`   Product already added to catalog "${catalogInfo.title}", skipping...`);
          }

          results.successful.push({
            currencyCode,
            price,
            catalogId: catalogInfo.id,
            catalogTitle: catalogInfo.title,
            pricebookName,
            priceListId: catalogInfo.priceListId,
          });
          console.log(`   ✅ Set ${currencyCode} price: ${price} (from ${pricebookName}) in catalog "${catalogInfo.title}"`);
        } else {
          results.failed.push({
            currencyCode,
            price,
            pricebookName,
            errors: setResult.errors || setResult.error,
          });
          console.log(`   ❌ Failed to set price for ${pricebookName}: ${JSON.stringify(setResult.errors || setResult.error)}`);
        }
        continue;
      }
      // ==================== END DYNAMIC CATALOG LOOKUP ====================

      // If catalog ID is specified, use catalog-specific pricing (existing logic)
      if (catalogId) {
        console.log(`   Using catalog-specific pricing for ${pricebookName}: ${catalogId}`);
        console.log(`   🔍 Catalog ID: ${catalogId}`);
        console.log(`   🔍 Currency: ${currencyCode}, Price: ${price}`);

        const setResult = await setVariantPriceInCatalog(catalogId, variantId, price, currencyCode);
        console.log(`   🔍 setVariantPriceInCatalog result: ${JSON.stringify(setResult)}`);

        if (setResult.success) {
          // Also add/include the product in the catalog (only once per catalog)
          if (productId && !processedCatalogs.has(catalogId)) {
            console.log(`   📦 Adding product to catalog (first time for this catalog)...`);
            console.log(`   📦 Product ID: ${productId}`);
            console.log(`   📦 Catalog ID: ${catalogId}`);
            const includeResult = await addProductToCatalog(catalogId, productId);
            console.log(`   📦 addProductToCatalog result: ${JSON.stringify(includeResult)}`);
            if (includeResult.success) {
              processedCatalogs.add(catalogId);
              console.log(`   📦 ✅ Successfully added product to catalog`);
            } else {
              console.warn(`   📦 ⚠️ Price set but failed to include product in catalog: ${JSON.stringify(includeResult.error || includeResult.errors)}`);
            }
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
          } else if (processedCatalogs.has(catalogId)) {
            console.log(`   Product already added to this catalog, skipping...`);
          }

          results.successful.push({
            currencyCode,
            price,
            catalogId,
            catalogTitle,
            pricebookName,
          });
          console.log(`   ✅ Set ${currencyCode} price: ${price} (from ${pricebookName}) in catalog ${catalogTitle || catalogId}`);
        } else {
          results.failed.push({
            currencyCode,
            price,
            catalogId,
            catalogTitle,
            pricebookName,
            errors: setResult.errors || setResult.error,
          });
          console.log(`   ❌ Failed to set price for ${pricebookName}: ${JSON.stringify(setResult.errors || setResult.error)}`);
        }
      } else {
        // Fallback to currency-based price list matching
        const priceList = priceLists.find(pl => pl.currency === currencyCode);

        if (!priceList) {
          results.skipped.push({
            currencyCode,
            pricebookName,
            reason: 'No price list found for this currency and no catalog ID specified',
          });
          continue;
        }

        // Set the price
        const setResult = await setMarketPrice(priceList.id, variantId, price, currencyCode);

        if (setResult.success) {
          results.successful.push({
            currencyCode,
            price,
            priceListId: priceList.id,
            pricebookName,
          });
          console.log(`Set ${currencyCode} price: ${price} (from ${pricebookName})`);
        } else {
          results.failed.push({
            currencyCode,
            price,
            pricebookName,
            errors: setResult.errors,
          });
        }
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return {
      success: results.failed.length === 0,
      results,
    };
  } catch (error) {
    console.error('Set variant international prices error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Clears the markets cache
 */
export const clearMarketsCache = () => {
  marketsCache = null;
};

// Cache for publications
let publicationsCache = null;

/**
 * Fetches all publications (sales channels) from the Shopify store
 */
export const getShopifyPublications = async () => {
  try {
    if (publicationsCache) {
      return publicationsCache;
    }

    const query = `
      query {
        publications(first: 50) {
          edges {
            node {
              id
              name
              supportsFuturePublishing
              catalog {
                id
                title
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    if (!result.success) {
      console.error('Failed to fetch publications:', result.errors);
      return [];
    }

    publicationsCache = result.data.publications.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      supportsFuturePublishing: e.node.supportsFuturePublishing,
      catalogId: e.node.catalog?.id,
      catalogTitle: e.node.catalog?.title,
    }));

    console.log(`📢 Fetched ${publicationsCache.length} publications:`);
    publicationsCache.forEach(p => {
      console.log(`   - ${p.name} (${p.id})`);
    });

    return publicationsCache;
  } catch (error) {
    console.error('Get publications error:', error.message);
    return [];
  }
};

/**
 * Clears the publications cache
 */
export const clearPublicationsCache = () => {
  publicationsCache = null;
};

export const publishProductToChannels = async (productId) => {
  try {
    // Fetch all publications dynamically
    const publications = await getShopifyPublications();

    if (publications.length === 0) {
      console.warn("⚠️ No publications found in the store");
      return { success: false, errors: [{ message: 'No publications found' }] };
    }

    const mutation = `
      mutation publishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            ... on Product {
              id
              title
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Create input array from all publications
    const input = publications.map(pub => ({
      publicationId: pub.id,
    }));

    console.log(`📢 Publishing product to ${publications.length} channels: ${publications.map(p => p.name).join(', ')}`);

    const variables = {
      id: productId,
      input,
    };

    const result = await shopifyGraphQL(mutation, variables);

    if (!result.success) {
      console.error("❌ Failed to publish product:", result.errors);
      return { success: false, errors: result.errors };
    }

    const errors = result.data.publishablePublish.userErrors;

    if (errors && errors.length > 0) {
      console.error("❌ Shopify publish errors:", errors);
      return { success: false, errors };
    }

    console.log(`✅ Product published to all ${publications.length} channels successfully`);

    return {
      success: true,
      productId,
    };
  } catch (error) {
    console.error("❌ Error publishing product:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

// ==================== COMPANY MANAGEMENT (B2B) ====================

/**
 * Metafield definitions for Company (from Salesforce Contact)
 */
const CUSTOMER_METAFIELD_DEFINITIONS = [
  { key: 'salesforce_contact_id', name: 'Salesforce Contact ID', type: 'single_line_text_field' },
  { key: 'salesforce_account_id', name: 'Salesforce Account ID', type: 'single_line_text_field' },
  { key: 'salesforce_account_name', name: 'Salesforce Account Name', type: 'single_line_text_field' },
  { key: 'mobile_phone', name: 'Mobile Phone', type: 'single_line_text_field' },
  { key: 'phone', name: 'Phone (Salesforce Fallback)', type: 'single_line_text_field' },
  { key: 'contact_record_type', name: 'Contact Record Type Name', type: 'single_line_text_field' },
  { key: 'record_type_id', name: 'Record Type ID', type: 'single_line_text_field' },
  { key: 'contact_title', name: 'Contact Title', type: 'single_line_text_field' },
  { key: 'contact_department', name: 'Contact Department', type: 'single_line_text_field' },
  { key: 'mailing_additional_info', name: 'Mailing Additional Info', type: 'single_line_text_field' },
  { key: 'contact_purpose', name: 'Contact Purpose', type: 'single_line_text_field' },
  { key: 'contact_status', name: 'Contact Status', type: 'single_line_text_field' },
  { key: 'created_by_id', name: 'Created By ID', type: 'single_line_text_field' },
  { key: 'created_date', name: 'Created Date', type: 'single_line_text_field' },
  { key: 'last_modified_by_id', name: 'Last Modified By ID', type: 'single_line_text_field' },
  { key: 'last_modified_date', name: 'Last Modified Date', type: 'single_line_text_field' },
];

const CUSTOMER_METAFIELD_NAMESPACE = 'salesforce';

// Cache for customer metafield definitions
let customerMetafieldDefinitionsCache = null;

/**
 * Fetches existing metafield definitions for CUSTOMER owner type
 */
export const getExistingCustomerMetafieldDefinitions = async () => {
  if (customerMetafieldDefinitionsCache) {
    return customerMetafieldDefinitionsCache;
  }

  const query = `
    query getCustomerMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: CUSTOMER) {
        edges {
          node {
            id
            name
            namespace
            key
            type {
              name
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query);
  if (result.success) {
    const definitions = result.data.metafieldDefinitions.edges.map(edge => ({
      id: edge.node.id,
      name: edge.node.name,
      namespace: edge.node.namespace,
      key: edge.node.key,
      type: edge.node.type.name,
    }));
    customerMetafieldDefinitionsCache = definitions;
    return definitions;
  }
  return [];
};

/**
 * Clears the customer metafield definitions cache
 */
export const clearCustomerMetafieldDefinitionsCache = () => {
  customerMetafieldDefinitionsCache = null;
};

/**
 * Ensures customer metafield definitions exist in Shopify
 */
export const ensureCustomerMetafieldDefinitions = async () => {
  console.log('🔧 Ensuring customer metafield definitions exist...');

  const existingDefinitions = await getExistingCustomerMetafieldDefinitions();

  for (const def of CUSTOMER_METAFIELD_DEFINITIONS) {
    const exists = existingDefinitions.find(
      e => e.namespace === CUSTOMER_METAFIELD_NAMESPACE && e.key === def.key
    );

    if (!exists) {
      console.log(`  Creating customer metafield definition: ${CUSTOMER_METAFIELD_NAMESPACE}.${def.key}`);

      const mutation = `
        mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition {
              id
              name
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        definition: {
          name: def.name,
          namespace: CUSTOMER_METAFIELD_NAMESPACE,
          key: def.key,
          type: def.type,
          ownerType: 'CUSTOMER',
        },
      };

      const result = await shopifyGraphQL(mutation, variables);

      if (!result.success || result.data.metafieldDefinitionCreate.userErrors.length > 0) {
        const errors = result.errors || result.data.metafieldDefinitionCreate.userErrors;
        console.error(`  ❌ Failed to create ${def.key}:`, errors);
      } else {
        console.log(`  ✅ Created ${def.key}`);
      }
    } else {
      console.log(`  ✓ ${CUSTOMER_METAFIELD_NAMESPACE}.${def.key} already exists`);
    }
  }

  // Clear cache to refetch
  customerMetafieldDefinitionsCache = null;
  console.log('✅ Customer metafield definitions check complete');
};

/**
 * Checks if a customer already exists in Shopify by email
 * @param {string} email - Email to search for
 * @returns {object|null} - Existing customer or null
 */
export const findCustomerByEmail = async (email) => {
  if (!email) return null;

  const query = `
    query findCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            metafields(first: 10, namespace: "salesforce") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query, { query: `email:${email}` });

  if (result.success && result.data.customers.edges.length > 0) {
    return result.data.customers.edges[0].node;
  }

  return null;
};

/**
 * Checks if a customer already exists in Shopify by Salesforce ID (via metafield)
 * @param {string} salesforceId - Salesforce Contact ID
 * @returns {object|null} - Existing customer or null
 */
export const findCustomerBySalesforceId = async (salesforceId) => {
  if (!salesforceId) return null;

  // Search customers by metafield value
  const query = `
    query findCustomerBySalesforceId($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            metafields(first: 10, namespace: "salesforce") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  // Search by metafield: salesforce.salesforce_contact_id (stored as "sf_contact_<id>")
  const result = await shopifyGraphQL(query, { query: `metafields.salesforce.salesforce_contact_id:${salesforceId}` });

  if (result.success && result.data.customers.edges.length > 0) {
    return result.data.customers.edges[0].node;
  }

  return null;
};

/**
 * Creates a customer in Shopify from Salesforce Contact data
 * @param {object} contactData - Transformed contact data
 * @param {boolean} skipExisting - Skip if customer already exists
 * @returns {object} - Result with customer details or error
 */
export const createShopifyCustomer = async (contactData, skipExisting = true, updateOnExist = true) => {
  try {
    const {
      salesforceId,
      firstName,
      lastName,
      salutation,
      email,
      phone,
      mobilePhone,
      accountName,
      accountId,
      title,
      department,
      recordTypeName,
      recordTypeId,
      mailingAdditionalInfo,
      contactPurpose,
      contactStatus,
      createdById,
      createdDate,
      lastModifiedById,
      lastModifiedDate,
      mailingAddress,
      installedProductModels,
      mailOptOut,
      taxExempt,
      region,
      speciality,
    } = contactData;

    // Prepend salutation to firstName if present
    const displayFirstName = salutation
      ? `${salutation} ${firstName || ''}`.trim()
      : (firstName || '');

    const customerName = `${displayFirstName} ${lastName || ''}`.trim() || 'Unknown';

    // Check if customer already exists by tag sf_contact_<salesforceId> — precise match, avoids
    // cross-account email collisions where the same email exists on multiple SF accounts.
    if (skipExisting) {
      if (salesforceId) {
        const existingByTagIds = await findShopifyCustomersByContactIds([salesforceId]);
        const existingId = existingByTagIds[0] || null;
        if (existingId) {
          if (!updateOnExist) {
            console.log(`⏭️  Customer already exists (tag: sf_contact_${salesforceId}) — skipping`);
            return {
              success: true,
              skipped: true,
              updated: false,
              reason: 'Customer already exists in Shopify — skipped',
              existingCustomerId: existingId,
              salesforceId,
            };
          }

          console.log(`🔄 Customer exists (tag: sf_contact_${salesforceId}) — updating metafields, taxExempt, email subscription...`);

          // Build salesforce-namespace metafields
          const updateMetafields = [];
          if (mobilePhone) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'mobile_phone', value: mobilePhone, type: 'single_line_text_field' });
          if (recordTypeName) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'contact_record_type', value: recordTypeName, type: 'single_line_text_field' });
          if (salesforceId) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'salesforce_contact_id', value: salesforceId, type: 'single_line_text_field' });
          if (accountId) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'salesforce_account_id', value: accountId, type: 'single_line_text_field' });
          if (accountName) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'salesforce_account_name', value: accountName, type: 'single_line_text_field' });
          if (title) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'contact_title', value: title, type: 'single_line_text_field' });
          if (department) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'contact_department', value: department, type: 'single_line_text_field' });
          if (recordTypeId) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'record_type_id', value: recordTypeId, type: 'single_line_text_field' });
          if (mailingAdditionalInfo) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'mailing_additional_info', value: mailingAdditionalInfo, type: 'single_line_text_field' });
          if (contactPurpose) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'contact_purpose', value: contactPurpose, type: 'single_line_text_field' });
          if (contactStatus) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'contact_status', value: contactStatus, type: 'single_line_text_field' });
          if (createdById) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'created_by_id', value: createdById, type: 'single_line_text_field' });
          if (createdDate) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'created_date', value: typeof createdDate === 'string' ? createdDate : new Date(createdDate).toISOString(), type: 'single_line_text_field' });
          if (lastModifiedById) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'last_modified_by_id', value: lastModifiedById, type: 'single_line_text_field' });
          if (lastModifiedDate) updateMetafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'last_modified_date', value: typeof lastModifiedDate === 'string' ? lastModifiedDate : new Date(lastModifiedDate).toISOString(), type: 'single_line_text_field' });

          // Update taxExempt, email subscription, and salesforce metafields
          const updateResult = await shopifyGraphQL(`
            mutation customerUpdate($input: CustomerInput!) {
              customerUpdate(input: $input) {
                customer { id }
                userErrors { field message }
              }
            }
          `, {
            input: {
              id: existingId,
              taxExempt: taxExempt === true,
              metafields: updateMetafields.length > 0 ? updateMetafields : undefined,
            },
          });
          const updateErrors = updateResult.data?.customerUpdate?.userErrors || [];
          if (!updateResult.success || updateErrors.length > 0) {
            console.warn(`  ⚠️ customerUpdate errors:`, updateResult.errors || updateErrors);
          } else {
            console.log(`  ✅ Updated taxExempt and salesforce metafields`);
          }

          // Update email marketing consent via dedicated mutation
          const emailConsentResult = await shopifyGraphQL(`
            mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
              customerEmailMarketingConsentUpdate(input: $input) {
                customer { id }
                userErrors { field message }
              }
            }
          `, {
            input: {
              customerId: existingId,
              emailMarketingConsent: {
                marketingState: mailOptOut ? 'UNSUBSCRIBED' : 'SUBSCRIBED',
                marketingOptInLevel: 'SINGLE_OPT_IN',
              },
            },
          });
          const emailConsentErrors = emailConsentResult.data?.customerEmailMarketingConsentUpdate?.userErrors || [];
          if (!emailConsentResult.success || emailConsentErrors.length > 0) {
            console.warn(`  ⚠️ Email consent update errors:`, emailConsentResult.errors || emailConsentErrors);
          } else {
            console.log(`  ✅ Updated email subscription`);
          }

          // Update custom namespace metafields (salutation, region, speciality, installed_product_model)
          const customMfToUpdate = [];
          if (salutation) customMfToUpdate.push({ ownerId: existingId, namespace: 'custom', key: 'salutation', value: salutation, type: 'single_line_text_field' });
          if (region) customMfToUpdate.push({ ownerId: existingId, namespace: 'custom', key: 'region', value: region, type: 'single_line_text_field' });
          if (speciality) customMfToUpdate.push({ ownerId: existingId, namespace: 'custom', key: 'speciality', value: speciality, type: 'single_line_text_field' });
          if (installedProductModels && installedProductModels.length > 0) {
            customMfToUpdate.push({ ownerId: existingId, namespace: 'custom', key: 'installed_product_model', value: JSON.stringify(installedProductModels), type: 'list.single_line_text_field' });
          }

          if (customMfToUpdate.length > 0) {
            const customMfResult = await shopifyGraphQL(`
              mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  metafields { key namespace value }
                  userErrors { field message }
                }
              }
            `, { metafields: customMfToUpdate });
            const customMfErrors = customMfResult.data?.metafieldsSet?.userErrors || [];
            if (!customMfResult.success || customMfErrors.length > 0) {
              console.warn(`  ⚠️ Failed to update custom metafields:`, customMfResult.errors || customMfErrors);
            } else {
              console.log(`  ✅ Updated custom metafields: salutation=${salutation || '-'} region=${region || '-'} speciality=${speciality || '-'} models=${installedProductModels?.length || 0}`);
            }
          }

          return {
            success: true,
            skipped: true,
            updated: true,
            reason: 'Customer already exists — updated metafields, taxExempt, email subscription',
            existingCustomerId: existingId,
            salesforceId,
          };
        }
      }
    }

    console.log(`👤 Creating customer: ${customerName} (${email})`);

    // Build the customer create mutation
    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            firstName
            lastName
            email
            phone
            addresses {
              id
              address1
              city
              province
              country
              zip
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Build metafields array for customer
    const metafields = [];

    if (mobilePhone) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'mobile_phone',
        value: mobilePhone,
        type: 'single_line_text_field',
      });
    }

    if (recordTypeName) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'contact_record_type',
        value: recordTypeName,
        type: 'single_line_text_field',
      });
    }

    if (salesforceId) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'salesforce_contact_id',
        value: salesforceId,
        type: 'single_line_text_field',
      });
    }

    if (accountId) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'salesforce_account_id',
        value: accountId,
        type: 'single_line_text_field',
      });
    }

    if (accountName) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'salesforce_account_name',
        value: accountName,
        type: 'single_line_text_field',
      });
    }

    if (title) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'contact_title',
        value: title,
        type: 'single_line_text_field',
      });
    }

    if (department) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'contact_department',
        value: department,
        type: 'single_line_text_field',
      });
    }

    if (recordTypeId) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'record_type_id',
        value: recordTypeId,
        type: 'single_line_text_field',
      });
    }

    if (mailingAdditionalInfo) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'mailing_additional_info',
        value: mailingAdditionalInfo,
        type: 'single_line_text_field',
      });
    }

    if (contactPurpose) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'contact_purpose',
        value: contactPurpose,
        type: 'single_line_text_field',
      });
    }

    if (contactStatus) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'contact_status',
        value: contactStatus,
        type: 'single_line_text_field',
      });
    }

    if (createdById) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'created_by_id',
        value: createdById,
        type: 'single_line_text_field',
      });
    }

    if (createdDate) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'created_date',
        value: typeof createdDate === 'string' ? createdDate : new Date(createdDate).toISOString(),
        type: 'single_line_text_field',
      });
    }

    if (lastModifiedById) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'last_modified_by_id',
        value: lastModifiedById,
        type: 'single_line_text_field',
      });
    }

    if (lastModifiedDate) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'last_modified_date',
        value: typeof lastModifiedDate === 'string' ? lastModifiedDate : new Date(lastModifiedDate).toISOString(),
        type: 'single_line_text_field',
      });
    }

    // Build customer input — use phone first, fall back to mobilePhone if no phone
    const primaryPhone = phone || null;
    const fallbackPhone = mobilePhone || null;
    let activePhone = primaryPhone || fallbackPhone || null;

    let customerInput = {
      firstName: displayFirstName,
      lastName: lastName || '',
      email: email,
      phone: activePhone || undefined,
      taxExempt: taxExempt === true,
      tags: salesforceId ? [`sf_contact_${salesforceId}`] : undefined,
      metafields: metafields.length > 0 ? metafields : undefined,
      emailMarketingConsent: {
        marketingState: mailOptOut ? 'UNSUBSCRIBED' : 'SUBSCRIBED',
        marketingOptInLevel: 'SINGLE_OPT_IN',
      },
    };

    // Add address if we have address data
    const hasAddressData = mailingAddress && (
      mailingAddress.street ||
      mailingAddress.city ||
      mailingAddress.postalCode ||
      mailingAddress.country ||
      mailingAddress.countryCode
    );

    if (hasAddressData) {
      const address = {
        address1: mailingAddress.street || '',
        address2: mailingAddress.additionalInfo || mailingAdditionalInfo || '',
        city: mailingAddress.city || '',
        country: mailingAddress.country || getCountryName(mailingAddress.countryCode) || 'United States',
        zip: mailingAddress.postalCode || '',
      };

      // Add province if we have state data
      if (mailingAddress.state || mailingAddress.stateCode) {
        address.province = mailingAddress.state || mailingAddress.stateCode;
      }

      customerInput.addresses = [address];
    }

    let result = await shopifyGraphQL(mutation, { input: customerInput });
    let phoneMovedToMetafield = false;

    if (!result.success) {
      console.error(`❌ Failed to create customer ${customerName}:`, result.errors);
      return {
        success: false,
        salesforceId,
        name: customerName,
        errors: result.errors,
      };
    }

    let userErrors = result.data.customerCreate.userErrors;

    // Phone/mobile phone invalid — retry with fallback, then without phone
    const hasPhoneError = (errors) => errors && errors.some(e =>
      e.field?.includes('phone') && (
        e.message?.toLowerCase().includes('invalid') ||
        e.message?.toLowerCase().includes('already been taken')
      )
    );

    if (hasPhoneError(userErrors) && activePhone) {
      // Save the failing phone value to metafield
      const failedPhone = activePhone;
      const isFailedPrimary = failedPhone === primaryPhone;
      const metafieldKey = (isFailedPrimary && primaryPhone !== fallbackPhone) ? 'phone' : 'mobile_phone';

      console.warn(`⚠️ Phone "${failedPhone}" invalid for "${customerName}" — saving to salesforce.${metafieldKey} metafield`);
      if (!customerInput.metafields) customerInput.metafields = [];
      // Only add metafield if not already present (mobilePhone metafield may already be set)
      const alreadyHas = customerInput.metafields.some(m => m.key === metafieldKey);
      if (!alreadyHas) {
        customerInput.metafields.push({
          namespace: CUSTOMER_METAFIELD_NAMESPACE,
          key: metafieldKey,
          value: String(failedPhone),
          type: 'single_line_text_field',
        });
      }
      phoneMovedToMetafield = true;

      // Try fallback phone (mobilePhone) if primary phone failed and they differ
      const nextPhone = (isFailedPrimary && fallbackPhone && fallbackPhone !== primaryPhone)
        ? fallbackPhone
        : null;

      if (nextPhone) {
        console.warn(`  🔄 Retrying with mobilePhone "${nextPhone}"...`);
        customerInput.phone = nextPhone;
        activePhone = nextPhone;
        result = await shopifyGraphQL(mutation, { input: customerInput });
        if (!result.success) {
          console.error(`❌ Failed to create customer ${customerName} (retry with mobilePhone):`, result.errors);
          return { success: false, salesforceId, name: customerName, errors: result.errors };
        }
        userErrors = result.data.customerCreate.userErrors;

        // mobilePhone also invalid — save and retry without any phone
        if (hasPhoneError(userErrors)) {
          console.warn(`  ⚠️ MobilePhone "${nextPhone}" also invalid — saving to metafield, retrying without phone...`);
          const alreadyHasMobile = customerInput.metafields.some(m => m.key === 'mobile_phone');
          if (!alreadyHasMobile) {
            customerInput.metafields.push({
              namespace: CUSTOMER_METAFIELD_NAMESPACE,
              key: 'mobile_phone',
              value: String(nextPhone),
              type: 'single_line_text_field',
            });
          }
          customerInput.phone = undefined;
          result = await shopifyGraphQL(mutation, { input: customerInput });
          if (!result.success) {
            console.error(`❌ Failed to create customer ${customerName} (retry no phone):`, result.errors);
            return { success: false, salesforceId, name: customerName, errors: result.errors };
          }
          userErrors = result.data.customerCreate.userErrors;
        }
      } else {
        // No fallback — retry without phone
        console.warn(`  🔄 Retrying without phone...`);
        customerInput.phone = undefined;
        result = await shopifyGraphQL(mutation, { input: customerInput });
        if (!result.success) {
          console.error(`❌ Failed to create customer ${customerName} (retry no phone):`, result.errors);
          return { success: false, salesforceId, name: customerName, errors: result.errors };
        }
        userErrors = result.data.customerCreate.userErrors;
      }
    }

    if (userErrors && userErrors.length > 0) {
      console.error(`❌ Customer creation errors for ${customerName}:`, userErrors);
      return {
        success: false,
        salesforceId,
        name: customerName,
        errors: userErrors,
      };
    }

    const customer = result.data.customerCreate.customer;
    console.log(`✅ Customer created: ${customer.firstName} ${customer.lastName} (${customer.id})${phoneMovedToMetafield ? ' (phone saved to metafield)' : ''}`);

    // Set custom.salutation, custom.region, custom.speciality
    const customMetafields = [];
    if (salutation) customMetafields.push({ ownerId: customer.id, namespace: 'custom', key: 'salutation', value: salutation, type: 'single_line_text_field' });
    if (region) customMetafields.push({ ownerId: customer.id, namespace: 'custom', key: 'region', value: region, type: 'single_line_text_field' });
    if (speciality) customMetafields.push({ ownerId: customer.id, namespace: 'custom', key: 'speciality', value: speciality, type: 'single_line_text_field' });

    if (customMetafields.length > 0) {
      const customMfResult = await shopifyGraphQL(`
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key namespace value }
            userErrors { field message }
          }
        }
      `, { metafields: customMetafields });
      const customMfErrors = customMfResult.data?.metafieldsSet?.userErrors || [];
      if (!customMfResult.success || customMfErrors.length > 0) {
        console.warn(`  ⚠️ Failed to set custom metafields:`, customMfResult.errors || customMfErrors);
      } else {
        console.log(`  ✅ Set custom metafields: salutation=${salutation || '-'} region=${region || '-'} speciality=${speciality || '-'}`);
      }
    }

    // Set installed product models as list metafield (custom.installed_product_model)
    if (installedProductModels && installedProductModels.length > 0) {
      console.log(`  🔧 Setting ${installedProductModels.length} installed product model(s) on customer...`);
      const listMfResult = await shopifyGraphQL(`
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key namespace value }
            userErrors { field message }
          }
        }
      `, {
        metafields: [{
          ownerId: customer.id,
          namespace: 'custom',
          key: 'installed_product_model',
          value: JSON.stringify(installedProductModels),
          type: 'list.single_line_text_field',
        }],
      });
      const listMfErrors = listMfResult.data?.metafieldsSet?.userErrors || [];
      if (!listMfResult.success || listMfErrors.length > 0) {
        console.warn(`  ⚠️ Failed to set installed_product_model:`, listMfResult.errors || listMfErrors);
      } else {
        console.log(`  ✅ Set installed_product_model: [${installedProductModels.join(', ')}]`);
      }
    }

    return {
      success: true,
      salesforceId,
      shopifyCustomerId: customer.id,
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone,
      addresses: customer.addresses || [],
    };

  } catch (error) {
    console.error(`❌ Error creating customer:`, error.message);
    return {
      success: false,
      salesforceId: contactData.salesforceId,
      error: error.message,
    };
  }
};

/**
 * Ensures a Salesforce contact is present as a Shopify customer and assigned to a company.
 *
 * Flow:
 *   1. Check if a Shopify customer exists with this email
 *   2. If not, create the customer via createShopifyCustomer
 *   3. Assign the customer to the company:
 *      - Existing customer → companyAssignCustomerAsContact
 *      - New customer created above → companyAssignCustomerAsContact as well
 *
 * @param {string} companyId  - Shopify Company GID (gid://shopify/Company/...)
 * @param {object} contact    - { salesforceId, firstName, lastName, email, phone, mobilePhone, accountId, accountName, mailingAddress }
 * @returns {object}          - { success, status ('created'|'existing'|'assigned'), shopifyCustomerId, companyContactId, error }
 */
export const ensureContactAssignedToCompany = async (companyId, contact) => {
  try {
    if (!contact.email) {
      return { success: false, error: 'No email — cannot create or find customer' };
    }

    let shopifyCustomerId = null;
    let status = null;

    // Step 1: Check if customer already exists
    const existingCustomer = await findCustomerByEmail(contact.email);

    if (existingCustomer) {
      shopifyCustomerId = existingCustomer.id;
      status = 'existing';
      console.log(`      👤 Customer already exists: ${contact.email} (${existingCustomer.id}) — updating...`);

      // Update salesforce-namespace metafields, taxExempt
      const sfMfs = [];
      if (contact.mobilePhone) sfMfs.push({ namespace: 'salesforce', key: 'mobile_phone', value: contact.mobilePhone, type: 'single_line_text_field' });
      if (contact.recordTypeName) sfMfs.push({ namespace: 'salesforce', key: 'contact_record_type', value: contact.recordTypeName, type: 'single_line_text_field' });
      if (contact.salesforceId) sfMfs.push({ namespace: 'salesforce', key: 'salesforce_contact_id', value: contact.salesforceId, type: 'single_line_text_field' });
      if (contact.accountId) sfMfs.push({ namespace: 'salesforce', key: 'salesforce_account_id', value: contact.accountId, type: 'single_line_text_field' });
      if (contact.accountName) sfMfs.push({ namespace: 'salesforce', key: 'salesforce_account_name', value: contact.accountName, type: 'single_line_text_field' });
      if (contact.title) sfMfs.push({ namespace: 'salesforce', key: 'contact_title', value: contact.title, type: 'single_line_text_field' });
      if (contact.department) sfMfs.push({ namespace: 'salesforce', key: 'contact_department', value: contact.department, type: 'single_line_text_field' });
      if (contact.recordTypeId) sfMfs.push({ namespace: 'salesforce', key: 'record_type_id', value: contact.recordTypeId, type: 'single_line_text_field' });
      if (contact.mailingAdditionalInfo) sfMfs.push({ namespace: 'salesforce', key: 'mailing_additional_info', value: contact.mailingAdditionalInfo, type: 'single_line_text_field' });
      if (contact.contactPurpose) sfMfs.push({ namespace: 'salesforce', key: 'contact_purpose', value: contact.contactPurpose, type: 'single_line_text_field' });
      if (contact.contactStatus) sfMfs.push({ namespace: 'salesforce', key: 'contact_status', value: contact.contactStatus, type: 'single_line_text_field' });
      if (contact.createdById) sfMfs.push({ namespace: 'salesforce', key: 'created_by_id', value: contact.createdById, type: 'single_line_text_field' });
      if (contact.createdDate) sfMfs.push({ namespace: 'salesforce', key: 'created_date', value: typeof contact.createdDate === 'string' ? contact.createdDate : new Date(contact.createdDate).toISOString(), type: 'single_line_text_field' });
      if (contact.lastModifiedById) sfMfs.push({ namespace: 'salesforce', key: 'last_modified_by_id', value: contact.lastModifiedById, type: 'single_line_text_field' });
      if (contact.lastModifiedDate) sfMfs.push({ namespace: 'salesforce', key: 'last_modified_date', value: typeof contact.lastModifiedDate === 'string' ? contact.lastModifiedDate : new Date(contact.lastModifiedDate).toISOString(), type: 'single_line_text_field' });

      const updateResult = await shopifyGraphQL(`
        mutation customerUpdate($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }
      `, {
        input: {
          id: shopifyCustomerId,
          taxExempt: contact.taxExempt === true,
          metafields: sfMfs.length > 0 ? sfMfs : undefined,
        },
      });
      const updateErrors = updateResult.data?.customerUpdate?.userErrors || [];
      if (!updateResult.success || updateErrors.length > 0) {
        console.warn(`      ⚠️ customerUpdate errors:`, updateResult.errors || updateErrors);
      } else {
        console.log(`      ✅ Updated taxExempt and salesforce metafields`);
      }

      // Update email marketing consent
      const emailConsentResult = await shopifyGraphQL(`
        mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
          customerEmailMarketingConsentUpdate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }
      `, {
        input: {
          customerId: shopifyCustomerId,
          emailMarketingConsent: {
            marketingState: contact.mailOptOut ? 'UNSUBSCRIBED' : 'SUBSCRIBED',
            marketingOptInLevel: 'SINGLE_OPT_IN',
          },
        },
      });
      const emailConsentErrors = emailConsentResult.data?.customerEmailMarketingConsentUpdate?.userErrors || [];
      if (!emailConsentResult.success || emailConsentErrors.length > 0) {
        console.warn(`      ⚠️ Email consent update errors:`, emailConsentResult.errors || emailConsentErrors);
      } else {
        console.log(`      ✅ Updated email subscription`);
      }

      // Update custom namespace metafields
      const customMfs = [];
      if (contact.salutation) customMfs.push({ ownerId: shopifyCustomerId, namespace: 'custom', key: 'salutation', value: contact.salutation, type: 'single_line_text_field' });
      if (contact.region) customMfs.push({ ownerId: shopifyCustomerId, namespace: 'custom', key: 'region', value: contact.region, type: 'single_line_text_field' });
      if (contact.speciality) customMfs.push({ ownerId: shopifyCustomerId, namespace: 'custom', key: 'speciality', value: contact.speciality, type: 'single_line_text_field' });
      if (contact.installedProductModels?.length > 0) {
        customMfs.push({ ownerId: shopifyCustomerId, namespace: 'custom', key: 'installed_product_model', value: JSON.stringify(contact.installedProductModels), type: 'list.single_line_text_field' });
      }

      if (customMfs.length > 0) {
        const mfResult = await shopifyGraphQL(`
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { key namespace value }
              userErrors { field message }
            }
          }
        `, { metafields: customMfs });
        const mfErrors = mfResult.data?.metafieldsSet?.userErrors || [];
        if (!mfResult.success || mfErrors.length > 0) {
          console.warn(`      ⚠️ Failed to update custom metafields:`, mfResult.errors || mfErrors);
        } else {
          console.log(`      ✅ Updated custom metafields: ${customMfs.map(m => m.key).join(', ')}`);
        }
      }
    } else {
      // Step 2: Create the customer (installedProductModels passed through contactData → set inside createShopifyCustomer)
      const createResult = await createShopifyCustomer(contact, false);

      if (!createResult.success) {
        return {
          success: false,
          email: contact.email,
          error: `Customer creation failed: ${JSON.stringify(createResult.errors || createResult.error)}`,
        };
      }

      shopifyCustomerId = createResult.shopifyCustomerId;
      status = 'created';
      console.log(`      ✅ Customer created: ${contact.email} (${shopifyCustomerId})`);
    }

    // Step 3: Assign customer to company as a contact
    const assignMutation = `
      mutation companyAssignCustomerAsContact($companyId: ID!, $customerId: ID!) {
        companyAssignCustomerAsContact(companyId: $companyId, customerId: $customerId) {
          companyContact {
            id
            customer {
              id
              email
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const assignResult = await shopifyGraphQL(assignMutation, {
      companyId,
      customerId: shopifyCustomerId,
    });

    if (!assignResult.success) {
      return {
        success: false,
        email: contact.email,
        shopifyCustomerId,
        status,
        error: `Assignment failed: ${JSON.stringify(assignResult.errors)}`,
      };
    }

    const assignErrors = assignResult.data.companyAssignCustomerAsContact.userErrors || [];

    // "already a contact" is not a real error — just skip gracefully
    const alreadyContact = assignErrors.some(e =>
      e.message?.toLowerCase().includes('already') ||
      e.message?.toLowerCase().includes('exists')
    );

    if (assignErrors.length > 0 && !alreadyContact) {
      return {
        success: false,
        email: contact.email,
        shopifyCustomerId,
        status,
        error: assignErrors.map(e => e.message).join(', '),
      };
    }

    let companyContactId = assignResult.data.companyAssignCustomerAsContact.companyContact?.id || null;

    if (alreadyContact) {
      console.log(`      ✅ Customer ${contact.email} already assigned to company — looking up companyContactId...`);
      // The assignment mutation returns no data on "already assigned" errors.
      // Query the company to find the existing companyContact for this customer.
      const lookupQuery = `
        query getCompanyContacts($companyId: ID!) {
          company(id: $companyId) {
            contacts(first: 100) {
              edges {
                node {
                  id
                  customer { id }
                }
              }
            }
          }
        }
      `;
      const lookupResult = await shopifyGraphQL(lookupQuery, { companyId });
      if (lookupResult.success) {
        const match = lookupResult.data.company?.contacts?.edges?.find(
          e => e.node.customer?.id === shopifyCustomerId
        );
        if (match) {
          companyContactId = match.node.id;
          console.log(`      ✅ Found existing companyContactId: ${companyContactId}`);
        }
      }
    } else {
      console.log(`      ✅ Customer ${contact.email} assigned to company (contact: ${companyContactId})`);
    }

    return {
      success: true,
      email: contact.email,
      shopifyCustomerId,
      companyContactId: companyContactId || null,
      status: alreadyContact ? 'already_assigned' : status,
    };

  } catch (error) {
    console.error(`❌ ensureContactAssignedToCompany error for ${contact.email}:`, error.message);
    return {
      success: false,
      email: contact.email,
      error: error.message,
    };
  }
};

/**
 * Creates a Shopify customer from a Salesforce Account (non-Net30 accounts).
 * One customer per account using Office_Email__c as email.
 * Sets custom.is_it_account = true to distinguish from contact-based customers.
 *
 * @param {object} accountData - Transformed account data
 * @param {boolean} skipExisting - Skip if customer already exists by email
 */
export const createShopifyCustomerFromAccount = async (accountData, skipExisting = true) => {
  try {
    const {
      salesforceId,
      name,
      phone,
      officeEmail,
      recordTypeName,
      billingAddress,
      installedProductModels,
      taxExempt,
    } = accountData;

    // Split account name: last word → lastName, rest → firstName
    const nameParts = (name || '').trim().split(/\s+/);
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : (nameParts[0] || name);

    // Check if customer already exists by email (only if email is present)
    if (skipExisting && officeEmail) {
      const existing = await findCustomerByEmail(officeEmail);
      if (existing) {
        console.log(`⏭️ Customer already exists for email ${officeEmail}: ${existing.id}`);
        return {
          success: true,
          skipped: true,
          reason: 'Customer already exists (matched by email)',
          existingCustomerId: existing.id,
          salesforceId,
          name,
          email: officeEmail,
        };
      }
    }

    console.log(`👤 Creating customer from account: "${name}" (${officeEmail || 'no email'}, ${phone || 'no phone'})`);

    // Build metafields
    const metafields = [
      {
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'salesforce_account_id',
        value: salesforceId,
        type: 'single_line_text_field',
      },
      {
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'salesforce_account_name',
        value: name,
        type: 'single_line_text_field',
      },
    ];

    if (recordTypeName) {
      metafields.push({
        namespace: CUSTOMER_METAFIELD_NAMESPACE,
        key: 'contact_record_type',
        value: recordTypeName,
        type: 'single_line_text_field',
      });
    }

    // custom.is_it_account — marks this customer as migrated from a Salesforce Account
    metafields.push({
      namespace: 'custom',
      key: 'is_it_account',
      value: 'true',
      type: 'boolean',
    });

    // Build customer input — email and phone are optional (Shopify allows neither)
    const customerInput = {
      firstName,
      lastName,
      taxExempt: taxExempt === true,
      metafields,
    };

    if (officeEmail) customerInput.email = officeEmail;
    if (phone) customerInput.phone = phone;

    // Add billing address as default address
    const hasAddress = billingAddress && (
      billingAddress.street || billingAddress.city || billingAddress.postalCode || billingAddress.country
    );
    if (hasAddress) {
      const address = {
        address1: billingAddress.street || '',
        address2: billingAddress.additionalInfo || '',
        city: billingAddress.city || '',
        zip: billingAddress.postalCode || '',
        country: billingAddress.country || getCountryName(billingAddress.countryCode) || 'United States',
      };
      if (billingAddress.state || billingAddress.stateCode) {
        address.province = billingAddress.state || billingAddress.stateCode;
      }
      customerInput.addresses = [address];
    }

    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            firstName
            email
            phone
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    let result = await shopifyGraphQL(mutation, { input: customerInput });

    if (!result.success) {
      const errMsg = JSON.stringify(result.errors || result);
      console.error(`  ❌ GraphQL request failed for "${name}": ${errMsg}`);
      return { success: false, salesforceId, name, error: errMsg };
    }

    let userErrors = result.data?.customerCreate?.userErrors;
    let warnings = [];

    // Helper: check if any error's field path contains a keyword
    const hasFieldError = (errors, keyword) =>
      errors && errors.some(e => {
        const field = Array.isArray(e.field) ? e.field.join('.') : (e.field || '');
        return field.includes(keyword);
      });

    const formatErrors = (errors) =>
      errors.map(e => `[${Array.isArray(e.field) ? e.field.join('.') : e.field}] ${e.message}`).join('; ');

    // Phone invalid — save to metafield and retry without phone
    if (hasFieldError(userErrors, 'phone') && customerInput.phone) {
      console.warn(`  ⚠️ Phone "${phone}" rejected for "${name}" — saving to metafield, retrying without phone...`);
      metafields.push({ namespace: CUSTOMER_METAFIELD_NAMESPACE, key: 'phone', value: String(phone), type: 'single_line_text_field' });
      delete customerInput.phone;
      warnings.push(`Phone invalid (saved to metafield): ${phone}`);
      result = await shopifyGraphQL(mutation, { input: customerInput });
      if (!result.success) {
        const errMsg = JSON.stringify(result.errors || result);
        console.error(`  ❌ Retry (no phone) failed for "${name}": ${errMsg}`);
        return { success: false, salesforceId, name, error: errMsg };
      }
      userErrors = result.data?.customerCreate?.userErrors;
    }

    // Address errors — create customer without address, record warning in report
    if (hasFieldError(userErrors, 'addresses') && customerInput.addresses) {
      const addrErrMsg = formatErrors(userErrors.filter(e => {
        const field = Array.isArray(e.field) ? e.field.join('.') : (e.field || '');
        return field.includes('addresses');
      }));
      console.warn(`  ⚠️ Address rejected for "${name}" — creating without address. Errors: ${addrErrMsg}`);
      warnings.push(`Address skipped: ${addrErrMsg}`);
      delete customerInput.addresses;
      result = await shopifyGraphQL(mutation, { input: customerInput });
      if (!result.success) {
        const errMsg = JSON.stringify(result.errors || result);
        console.error(`  ❌ Retry (no address) failed for "${name}": ${errMsg}`);
        return { success: false, salesforceId, name, error: errMsg };
      }
      userErrors = result.data?.customerCreate?.userErrors;
    }

    if (userErrors && userErrors.length > 0) {
      const errMsg = formatErrors(userErrors);
      console.error(`  ❌ userErrors for "${name}": ${errMsg}`);
      return { success: false, salesforceId, name, error: errMsg };
    }

    const customer = result.data?.customerCreate?.customer;
    if (!customer) {
      const errMsg = 'customerCreate returned no customer and no userErrors';
      console.error(`  ❌ ${errMsg} for "${name}"`);
      return { success: false, salesforceId, name, error: errMsg };
    }

    const warningStr = warnings.length > 0 ? warnings.join(' | ') : null;
    console.log(`  ✅ Created customer: "${name}" → ${customer.id} (email: ${customer.email || 'none'}, phone: ${customer.phone || 'none'})${warningStr ? ` ⚠️ ${warningStr}` : ''}`);

    // Set installed product models as list metafield (custom.installed_product_model)
    if (installedProductModels && installedProductModels.length > 0) {
      console.log(`  🔧 Setting ${installedProductModels.length} installed product model(s) on customer...`);
      const listMfResult = await shopifyGraphQL(`
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key namespace value }
            userErrors { field message }
          }
        }
      `, {
        metafields: [{
          ownerId: customer.id,
          namespace: 'custom',
          key: 'installed_product_model',
          value: JSON.stringify(installedProductModels),
          type: 'list.single_line_text_field',
        }],
      });
      const listMfErrors = listMfResult.data?.metafieldsSet?.userErrors || [];
      if (!listMfResult.success || listMfErrors.length > 0) {
        console.warn(`  ⚠️ Failed to set installed_product_model:`, listMfResult.errors || listMfErrors);
        warnings.push(`installed_product_model metafield failed`);
      } else {
        console.log(`  ✅ Set installed_product_model: [${installedProductModels.join(', ')}]`);
      }
    }

    return {
      success: true,
      salesforceId,
      name,
      shopifyCustomerId: customer.id,
      email: officeEmail,
      warning: warnings.length > 0 ? warnings.join(' | ') : null,
    };

  } catch (error) {
    console.error(`❌ createShopifyCustomerFromAccount error for "${accountData.name}":`, error.message);
    return { success: false, salesforceId: accountData.salesforceId, name: accountData.name, error: error.message };
  }
};

/**
 * Batch create customers from Salesforce contacts
 * @param {array} contacts - Array of transformed contact data
 * @param {number} delayBetween - Delay between creations in ms
 * @param {boolean} skipExisting - Skip existing customers
 * @returns {object} - Results summary
 */
export const createShopifyCustomersBatch = async (contacts, delayBetween = 500, skipExisting = true) => {
  const results = {
    successful: [],
    failed: [],
    skipped: [],
  };

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    console.log(`\n[${i + 1}/${contacts.length}] Processing: ${contact.firstName} ${contact.lastName} (${contact.email})`);

    const result = await createShopifyCustomer(contact, skipExisting);

    if (result.skipped) {
      results.skipped.push(result);
    } else if (result.success) {
      results.successful.push(result);
    } else {
      results.failed.push(result);
    }

    // Delay between API calls
    if (i < contacts.length - 1 && delayBetween > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetween));
    }
  }

  console.log(`\n📊 Batch complete: ✅ ${results.successful.length} | ❌ ${results.failed.length} | ⏭️ ${results.skipped.length}`);

  return results;
};

/**
 * Helper function to convert country code to country name
 * @param {string} countryCode - ISO country code
 * @returns {string} - Country name
 */
const getCountryName = (countryCode) => {
  if (!countryCode) return 'United States';

  const codeToName = {
    'US': 'United States',
    'CA': 'Canada',
    'GB': 'United Kingdom',
    'AU': 'Australia',
    'NZ': 'New Zealand',
    'DE': 'Germany',
    'FR': 'France',
    'ES': 'Spain',
    'IT': 'Italy',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'JP': 'Japan',
    'CN': 'China',
    'IN': 'India',
    'BR': 'Brazil',
    'MX': 'Mexico',
    'SG': 'Singapore',
    'HK': 'Hong Kong',
    'TW': 'Taiwan',
    'KR': 'South Korea',
  };

  return codeToName[countryCode.toUpperCase()] || countryCode;
};

/**
 * Helper function to convert country name to ISO country code
 * @param {string} countryName - Country name
 * @returns {string} - ISO country code
 */
const getCountryCode = (countryName) => {
  if (!countryName) return null;

  const countryMap = {
    // North America
    'united states': 'US', 'usa': 'US', 'us': 'US', 'united states of america': 'US',
    'canada': 'CA',
    'mexico': 'MX',
    // Europe
    'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
    'germany': 'DE',
    'france': 'FR',
    'spain': 'ES',
    'italy': 'IT',
    'netherlands': 'NL', 'holland': 'NL',
    'belgium': 'BE',
    'switzerland': 'CH',
    'austria': 'AT',
    'sweden': 'SE',
    'norway': 'NO',
    'denmark': 'DK',
    'finland': 'FI',
    'portugal': 'PT',
    'ireland': 'IE',
    'poland': 'PL',
    'czech republic': 'CZ', 'czechia': 'CZ',
    'hungary': 'HU',
    'romania': 'RO',
    'greece': 'GR',
    'turkey': 'TR',
    'russia': 'RU',
    // Asia Pacific
    'australia': 'AU',
    'new zealand': 'NZ',
    'japan': 'JP',
    'china': 'CN',
    'india': 'IN',
    'singapore': 'SG',
    'hong kong': 'HK',
    'taiwan': 'TW',
    'south korea': 'KR', 'korea': 'KR',
    'thailand': 'TH',
    'malaysia': 'MY',
    'indonesia': 'ID',
    'philippines': 'PH',
    'vietnam': 'VN',
    // Middle East
    'united arab emirates': 'AE', 'uae': 'AE',
    'saudi arabia': 'SA',
    'kuwait': 'KW',
    'qatar': 'QA',
    'bahrain': 'BH',
    'oman': 'OM',
    'jordan': 'JO',
    'lebanon': 'LB',
    'israel': 'IL',
    'iraq': 'IQ',
    'iran': 'IR',
    // Africa
    'south africa': 'ZA',
    'egypt': 'EG',
    'nigeria': 'NG',
    'kenya': 'KE',
    'morocco': 'MA',
    // Latin America
    'brazil': 'BR',
    'argentina': 'AR',
    'colombia': 'CO',
    'chile': 'CL',
    'peru': 'PE',
  };

  // Return null if not found — callers should handle unknown country gracefully
  return countryMap[countryName.toLowerCase().trim()] || null;
};

// ═══════════════════════════════════════════════════════════════
//  COMPANY (B2B) — Salesforce Account → Shopify Company
// ═══════════════════════════════════════════════════════════════

const COMPANY_METAFIELD_DEFINITIONS = [
  { key: 'salesforce_account_id', name: 'Salesforce Account ID', type: 'single_line_text_field' },
  { key: 'account_number', name: 'Account Number', type: 'single_line_text_field' },
  { key: 'account_number_candela_oracle', name: 'Account Number Candela Oracle', type: 'single_line_text_field' },
  { key: 'account_type', name: 'Account Type', type: 'single_line_text_field' },
  { key: 'industry', name: 'Industry', type: 'single_line_text_field' },
  { key: 'record_type_name', name: 'Record Type Name', type: 'single_line_text_field' },
  { key: 'owner_id', name: 'Owner ID', type: 'single_line_text_field' },
  { key: 'owner_name', name: 'Owner Name', type: 'single_line_text_field' },
  { key: 'parent_name', name: 'Parent Name', type: 'single_line_text_field' },
  { key: 'region', name: 'Region', type: 'single_line_text_field' },
  { key: 'account_activity_status', name: 'Account Activity Status', type: 'single_line_text_field' },
  { key: 'account_status', name: 'Account Status', type: 'single_line_text_field' },
  { key: 'credit_hold', name: 'Credit Hold', type: 'single_line_text_field' },
  { key: 'pay_in_advance', name: 'Pay In Advance', type: 'single_line_text_field' },
  { key: 'tax_exempt', name: 'Tax Exempt', type: 'single_line_text_field' },
  { key: 'net30_online_orders', name: 'Net 30 Online Orders', type: 'single_line_text_field' },
  { key: 'shop_price_book', name: 'Shop Price Book', type: 'single_line_text_field' },
  { key: 'office_email', name: 'Office Email', type: 'single_line_text_field' },
  { key: 'primary_operating_unit', name: 'Primary Operating Unit', type: 'single_line_text_field' },
  { key: 'phone', name: 'Phone', type: 'single_line_text_field' },
  { key: 'created_by_id', name: 'Created By ID', type: 'single_line_text_field' },
  { key: 'created_date', name: 'Created Date', type: 'single_line_text_field' },
  { key: 'last_modified_by_id', name: 'Last Modified By ID', type: 'single_line_text_field' },
  { key: 'last_modified_date', name: 'Last Modified Date', type: 'single_line_text_field' },
  { key: 'latitude', name: 'Latitude', type: 'single_line_text_field' },
  { key: 'longitude', name: 'Longitude', type: 'single_line_text_field' },
  { key: 'legal_operating_account_name', name: 'Legal Operating Account Name', type: 'single_line_text_field' },
  { key: 'oracle_cloud_account_number', name: 'Oracle Cloud Account Number', type: 'single_line_text_field' },
  { key: 'oracle_cust_account_id', name: 'Oracle Cust Account ID', type: 'single_line_text_field' },
  { key: 'oracle_party_id', name: 'Oracle Party ID', type: 'single_line_text_field' },
  { key: 'speciality', name: 'Speciality', type: 'single_line_text_field' },
  { key: 'sub_category', name: 'Sub Category', type: 'single_line_text_field' },
  { key: 'interface_status', name: 'Interface Status', type: 'single_line_text_field' },
  { key: 'interface_update', name: 'Interface Update', type: 'single_line_text_field' },
  { key: 'bill_to_additional_address_info', name: 'Bill To Additional Address Info', type: 'single_line_text_field' },
  { key: 'bill_to_address_validated', name: 'Bill To Address Validated', type: 'single_line_text_field' },
  { key: 'ship_to_additional_address_info', name: 'Ship To Additional Address Info', type: 'single_line_text_field' },
  { key: 'ship_to_address_validated', name: 'Ship To Address Validated', type: 'single_line_text_field' },
  { key: 'tax_id', name: 'Tax ID', type: 'single_line_text_field' },
  { key: 'vat_number', name: 'VAT Number', type: 'single_line_text_field' },
  { key: 'vat_registration_country', name: 'VAT Registration Country', type: 'single_line_text_field' },
  { key: 'billing_street', name: 'Billing Street (Raw)', type: 'single_line_text_field' },
  { key: 'shipping_street', name: 'Shipping Street (Raw)', type: 'single_line_text_field' },
];

const COMPANY_METAFIELD_NAMESPACE = 'salesforce';

/**
 * Maps Salesforce region/territory values to ISO country codes.
 * US sub-regions map to 'US'; country names map to their code.
 */
const REGION_TO_COUNTRY_CODE = {
  // US regions
  'southeast': 'US',
  'northeast': 'US',
  'west': 'US',
  'midwest': 'US',
  'central': 'US',
  'southwest': 'US',
  'northwest': 'US',
  'south': 'US',
  'north': 'US',
  'east': 'US',
  'mid-atlantic': 'US',
  'pacific': 'US',
  'mountain': 'US',
  'great lakes': 'US',
  'plains': 'US',
  // Countries
  'japan': 'JP',
  'canada': 'CA',
  'united kingdom': 'GB',
  'uk': 'GB',
  'australia': 'AU',
  'germany': 'DE',
  'france': 'FR',
  'spain': 'ES',
  'italy': 'IT',
  'netherlands': 'NL',
  'belgium': 'BE',
  'switzerland': 'CH',
  'austria': 'AT',
  'new zealand': 'NZ',
  'singapore': 'SG',
  'hong kong': 'HK',
  'taiwan': 'TW',
  'south korea': 'KR',
  'korea': 'KR',
  'china': 'CN',
  'india': 'IN',
  'brazil': 'BR',
  'mexico': 'MX',
  'israel': 'IL',
  'uae': 'AE',
  'united arab emirates': 'AE',
  'saudi arabia': 'SA',
};

/**
 * Derives a country code from the account's region/territory.
 * Falls back to address country, then 'US'.
 */
export const getCountryCodeFromRegion = (region, addressCountryCode, addressCountry) => {
  // 1. Try address country code directly (most explicit)
  if (addressCountryCode && addressCountryCode.length === 2) {
    return addressCountryCode.toUpperCase();
  }

  // 2. Try address country name (explicit address takes priority over region)
  if (addressCountry) {
    const fromName = getCountryCode(addressCountry);
    if (fromName && fromName.length === 2) return fromName;
  }

  // 3. Try mapping region to country code
  if (region) {
    const mapped = REGION_TO_COUNTRY_CODE[region.toLowerCase().trim()];
    if (mapped) return mapped;
  }

  // 4. If region looks like a 2-letter code already
  if (region && region.length === 2) {
    return region.toUpperCase();
  }

  return null;
};

/**
 * Ensures a Shopify market exists for the given country code.
 * Uses existing getShopifyMarkets/clearMarketsCache.
 * Returns the market or null. Creates one if none found.
 */
export const ensureMarketForCountry = async (countryCode, countryName) => {
  const markets = await getShopifyMarkets();

  // Check if any existing market includes this country
  const existingMarket = markets.find(m =>
    m.countries.some(c => c.code === countryCode)
  );
  if (existingMarket) {
    console.log(`  🌍 Market "${existingMarket.name}" already includes ${countryCode}`);
    return existingMarket;
  }

  // No market found for this country — create one
  const marketName = countryName || countryCode;
  console.log(`  🌍 No market found for ${countryCode}, creating "${marketName}" market...`);

  const mutation = `
    mutation marketCreate($input: MarketCreateInput!) {
      marketCreate(input: $input) {
        market {
          id
          name
          handle
          enabled
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const handle = countryCode.toLowerCase();
  const result = await shopifyGraphQL(mutation, {
    input: {
      name: marketName,
      handle,
      enabled: true,
      conditions: {
        regionsCondition: {
          regions: [{ countryCode }],
        },
      },
    },
  });

  if (!result.success || result.data.marketCreate.userErrors?.length > 0) {
    const errors = result.errors || result.data.marketCreate.userErrors;
    console.warn(`  ⚠️ Failed to create market "${marketName}":`, errors);
    return null;
  }

  const newMarket = result.data.marketCreate.market;
  console.log(`  ✅ Created market "${newMarket.name}" (${newMarket.id}) for ${countryCode}`);

  // Clear cache so next lookup picks up the new market
  clearMarketsCache();

  return {
    id: newMarket.id,
    name: newMarket.name,
  };
};

// Cache for company metafield definitions
let companyMetafieldDefinitionsCache = null;

/**
 * Fetches existing metafield definitions for COMPANY owner type
 */
export const getExistingCompanyMetafieldDefinitions = async () => {
  if (companyMetafieldDefinitionsCache) {
    return companyMetafieldDefinitionsCache;
  }

  const query = `
    query getCompanyMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: COMPANY) {
        edges {
          node {
            id
            name
            namespace
            key
            type {
              name
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query);
  if (result.success) {
    const definitions = result.data.metafieldDefinitions.edges.map(edge => ({
      id: edge.node.id,
      name: edge.node.name,
      namespace: edge.node.namespace,
      key: edge.node.key,
      type: edge.node.type.name,
    }));
    companyMetafieldDefinitionsCache = definitions;
    return definitions;
  }
  return [];
};

/**
 * Clears the company metafield definitions cache
 */
export const clearCompanyMetafieldDefinitionsCache = () => {
  companyMetafieldDefinitionsCache = null;
};

/**
 * Ensures company metafield definitions exist in Shopify
 */
export const ensureCompanyMetafieldDefinitions = async () => {
  console.log('🔧 Ensuring company metafield definitions exist...');

  const existingDefinitions = await getExistingCompanyMetafieldDefinitions();

  for (const def of COMPANY_METAFIELD_DEFINITIONS) {
    const exists = existingDefinitions.find(
      e => e.namespace === COMPANY_METAFIELD_NAMESPACE && e.key === def.key
    );

    if (!exists) {
      console.log(`  Creating company metafield definition: ${COMPANY_METAFIELD_NAMESPACE}.${def.key}`);

      const mutation = `
        mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition {
              id
              name
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        definition: {
          name: def.name,
          namespace: COMPANY_METAFIELD_NAMESPACE,
          key: def.key,
          type: def.type,
          ownerType: 'COMPANY',
        },
      };

      const result = await shopifyGraphQL(mutation, variables);

      if (!result.success || result.data.metafieldDefinitionCreate.userErrors.length > 0) {
        const errors = result.errors || result.data.metafieldDefinitionCreate.userErrors;
        console.error(`  ❌ Failed to create ${def.key}:`, errors);
      } else {
        console.log(`  ✅ Created ${def.key}`);
      }
    } else {
      console.log(`  ✓ ${COMPANY_METAFIELD_NAMESPACE}.${def.key} already exists`);
    }
  }

  // Clear cache to refetch
  companyMetafieldDefinitionsCache = null;
  console.log('✅ Company metafield definitions check complete');
};

// ═══════════════════════════════════════════════════════════════
//  COMPANY LOCATION metafield definitions
// ═══════════════════════════════════════════════════════════════

const COMPANY_LOCATION_METAFIELD_DEFINITIONS = [
  { key: 'salesforce_site_id', name: 'Salesforce Site ID', type: 'single_line_text_field' },
  { key: 'created_by_id', name: 'Created By ID', type: 'single_line_text_field' },
  { key: 'created_date', name: 'Created Date', type: 'single_line_text_field' },
  { key: 'last_modified_by_id', name: 'Last Modified By ID', type: 'single_line_text_field' },
  { key: 'last_modified_date', name: 'Last Modified Date', type: 'single_line_text_field' },
  { key: 'oracle_cloud_account_number', name: 'Oracle Cloud Account Number', type: 'single_line_text_field' },
  { key: 'location_address_unique', name: 'Location Address Unique', type: 'single_line_text_field' },
  { key: 'location_name_unique', name: 'Location Name Unique', type: 'single_line_text_field' },
  { key: 'informatica_validation_date', name: 'Informatica Validation Date', type: 'single_line_text_field' },
  { key: 'is_address_validated', name: 'Is Address Validated', type: 'boolean' },
  { key: 'latitude', name: 'Latitude', type: 'single_line_text_field' },
  { key: 'longitude', name: 'Longitude', type: 'single_line_text_field' },
  { key: 'site_number', name: 'Site Number', type: 'single_line_text_field' },
  { key: 'dunning', name: 'Dunning', type: 'boolean' },
  { key: 'statement', name: 'Statement', type: 'boolean' },
  { key: 'accounting_region_code', name: 'Accounting Region Code', type: 'single_line_text_field' },
  { key: 'dunning_use_id', name: 'Dunning Use ID', type: 'single_line_text_field' },
  { key: 'interface_to_oracle', name: 'Interface To Oracle', type: 'single_line_text_field' },
  { key: 'oracle_cloud_bill_to_site_id', name: 'Oracle Cloud Bill To Site ID', type: 'single_line_text_field' },
  { key: 'oracle_cloud_cust_acct_site_id', name: 'Oracle Cloud Cust Acct Site ID', type: 'single_line_text_field' },
  { key: 'oracle_cloud_location_id', name: 'Oracle Cloud Location ID', type: 'single_line_text_field' },
  { key: 'oracle_cloud_party_site_id', name: 'Oracle Cloud Party Site ID', type: 'single_line_text_field' },
  { key: 'oracle_cloud_site_use_id', name: 'Oracle Cloud Site Use ID', type: 'single_line_text_field' },
  { key: 'oracle_cust_account_id', name: 'Oracle Cust Account ID', type: 'single_line_text_field' },
  { key: 'statement_use_id', name: 'Statement Use ID', type: 'single_line_text_field' },
  { key: 'status', name: 'Status', type: 'single_line_text_field' },
  { key: 'location_type', name: 'Location Type', type: 'single_line_text_field' },
  { key: 'tax_registration_number', name: 'Tax Registration Number', type: 'single_line_text_field' },
  { key: 'vat_registration_country', name: 'VAT Registration Country', type: 'single_line_text_field' },
  { key: 'operating_unit', name: 'Operating Unit', type: 'single_line_text_field' },
  { key: 'bill_to_flag', name: 'Bill To Flag', type: 'boolean' },
  { key: 'ship_to_flag', name: 'Ship To Flag', type: 'boolean' },
  { key: 'account_id', name: 'Account ID', type: 'single_line_text_field' },
];

let companyLocationMetafieldDefinitionsCache = null;

export const clearCompanyLocationMetafieldDefinitionsCache = () => {
  companyLocationMetafieldDefinitionsCache = null;
};

const getExistingCompanyLocationMetafieldDefinitions = async () => {
  if (companyLocationMetafieldDefinitionsCache) return companyLocationMetafieldDefinitionsCache;

  const query = `
    query {
      metafieldDefinitions(first: 100, ownerType: COMPANY_LOCATION) {
        edges {
          node { id name namespace key type { name } }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query);
  if (result.success) {
    companyLocationMetafieldDefinitionsCache = result.data.metafieldDefinitions.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      namespace: e.node.namespace,
      key: e.node.key,
      type: e.node.type.name,
    }));
    return companyLocationMetafieldDefinitionsCache;
  }
  return [];
};

export const ensureCompanyLocationMetafieldDefinitions = async () => {
  console.log('🔧 Ensuring company location metafield definitions exist...');

  const existingDefinitions = await getExistingCompanyLocationMetafieldDefinitions();

  const mutation = `
    mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id name namespace key }
        userErrors { field message }
      }
    }
  `;

  for (const def of COMPANY_LOCATION_METAFIELD_DEFINITIONS) {
    const exists = existingDefinitions.find(
      e => e.namespace === COMPANY_METAFIELD_NAMESPACE && e.key === def.key
    );
    if (!exists) {
      console.log(`  Creating location metafield: ${COMPANY_METAFIELD_NAMESPACE}.${def.key}`);
      const result = await shopifyGraphQL(mutation, {
        definition: {
          name: def.name,
          namespace: COMPANY_METAFIELD_NAMESPACE,
          key: def.key,
          type: def.type,
          ownerType: 'COMPANY_LOCATION',
        },
      });
      if (!result.success || result.data.metafieldDefinitionCreate.userErrors.length > 0) {
        console.error(`  ❌ Failed to create ${def.key}:`, result.errors || result.data.metafieldDefinitionCreate.userErrors);
      } else {
        console.log(`  ✅ Created ${def.key}`);
      }
    } else {
      console.log(`  ✓ ${COMPANY_METAFIELD_NAMESPACE}.${def.key} already exists`);
    }
  }

  companyLocationMetafieldDefinitionsCache = null;
  console.log('✅ Company location metafield definitions check complete');
};

/**
 * Finds a company in Shopify by name
 * @param {string} name - Company name to search for
 * @returns {object|null} - Existing company or null
 */
export const findCompanyByName = async (name) => {
  if (!name) return null;

  const query = `
    query findCompanyByName($query: String!) {
      companies(first: 1, query: $query) {
        edges {
          node {
            id
            name
            externalId
            note
            metafields(first: 20, namespace: "salesforce") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query, { query: `name:${name}` });

  if (result.success && result.data.companies.edges.length > 0) {
    const found = result.data.companies.edges[0].node;
    // Verify exact name match (Shopify search is fuzzy)
    if (found.name === name) {
      return found;
    }
  }

  return null;
};

/**
 * Applies buyer experience config (payment terms, editable shipping, checkout mode) to a location.
 * Module-level so it can be used both for new and existing companies.
 */
const applyLocationBuyerConfig = async (locId, label, buyerConfig, phone) => {
  const mutation = `
    mutation companyLocationUpdate($companyLocationId: ID!, $input: CompanyLocationUpdateInput!) {
      companyLocationUpdate(companyLocationId: $companyLocationId, input: $input) {
        companyLocation {
          id
          buyerExperienceConfiguration {
            editableShippingAddress
            paymentTermsTemplate { id name }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const input = { buyerExperienceConfiguration: buyerConfig };
  if (phone) input.phone = phone;

  let result = await shopifyGraphQL(mutation, { companyLocationId: locId, input });

  if (result.success) {
    const phoneErrors = (result.data.companyLocationUpdate.userErrors || []).filter(err =>
      err.field?.some?.(f => f.toLowerCase().includes('phone')) ||
      err.message?.toLowerCase().includes('phone')
    );
    if (phoneErrors.length > 0) {
      result = await shopifyGraphQL(mutation, {
        companyLocationId: locId,
        input: { buyerExperienceConfiguration: buyerConfig },
      });
    }
  }

  if (!result.success || result.data?.companyLocationUpdate?.userErrors?.length > 0) {
    console.warn(`  ⚠️ Failed to update location config on ${label}`);
  } else {
    const config = result.data.companyLocationUpdate.companyLocation.buyerExperienceConfiguration;
    console.log(`  📦 ${label}: editableShippingAddress=${config.editableShippingAddress}, paymentTerms=${config.paymentTermsTemplate?.name || 'none'}`);
  }
};

/**
 * Fetches all contact IDs and the admin role ID for an existing Shopify company.
 */
const getCompanyContactsAndAdminRole = async (companyId) => {
  const query = `
    query getCompanyContactsAndRoles($companyId: ID!) {
      company(id: $companyId) {
        contacts(first: 250) {
          edges { node { id } }
        }
        contactRoles(first: 10) {
          edges { node { id name } }
        }
      }
    }
  `;
  const result = await shopifyGraphQL(query, { companyId });
  if (!result.success || !result.data?.company) return { contactIds: [], adminRoleId: null };

  const contactIds = result.data.company.contacts.edges.map(e => e.node.id);
  const roles = result.data.company.contactRoles.edges.map(e => e.node);
  const adminRole = roles.find(r => r.name === 'Admin') || roles[0];
  return { contactIds, adminRoleId: adminRole?.id || null };
};

/**
 * Finds a company in Shopify by Salesforce Account ID (stored as externalId)
 * @param {string} salesforceId - Salesforce Account ID
 * @returns {object|null} - Existing company or null
 */
export const findCompanyBySalesforceId = async (salesforceId) => {
  if (!salesforceId) return null;

  const query = `
    query findCompanyBySalesforceId($query: String!) {
      companies(first: 1, query: $query) {
        edges {
          node {
            id
            name
            externalId
            note
            metafields(first: 20, namespace: "salesforce") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query, { query: `external_id:"${salesforceId}"` });

  if (result.success && result.data.companies.edges.length > 0) {
    const found = result.data.companies.edges[0].node;
    // Verify exact externalId match (Shopify search is fuzzy)
    if (found.externalId === salesforceId) {
      return found;
    }
  }

  return null;
};

/**
 * Updates phone on ALL locations of an existing Shopify B2B company.
 * Called when a company already exists so the phone is still kept in sync.
 * If Shopify rejects the phone format (requires E.164, e.g. +12025551234)
 * it logs a warning and moves on — the rest of the sync is not affected.
 */
const syncPhoneToAllLocations = async (companyId, phone) => {
  // Fetch locations along with their current billing/shipping addresses
  const locationsQuery = `
    query getCompanyLocations($companyId: ID!) {
      company(id: $companyId) {
        locations(first: 50) {
          edges {
            node {
              id
              name
              billingAddress {
                address1
                address2
                city
                countryCode
                zoneCode
                zip
                phone
              }
              shippingAddress {
                address1
                address2
                city
                countryCode
                zoneCode
                zip
                phone
              }
            }
          }
        }
      }
    }
  `;

  const locResult = await shopifyGraphQL(locationsQuery, { companyId });
  if (!locResult.success) {
    console.warn(`⚠️ Could not fetch locations for company ${companyId}:`, locResult.errors);
    return;
  }

  const locations = locResult.data?.company?.locations?.edges || [];
  if (locations.length === 0) {
    console.warn(`⚠️ No locations found for company ${companyId}. Cannot sync phone.`);
    return;
  }

  const mutation = `
    mutation companyLocationUpdatePhone($companyLocationId: ID!, $input: CompanyLocationUpdateInput!) {
      companyLocationUpdate(companyLocationId: $companyLocationId, input: $input) {
        companyLocation { id name phone }
        userErrors { field message }
      }
    }
  `;

  // Helper to build an address input with phone added (only if address has required countryCode)
  const buildAddrWithPhone = (addr) => {
    if (!addr?.countryCode) return null;
    const built = { countryCode: addr.countryCode, phone };
    if (addr.address1) built.address1 = addr.address1;
    if (addr.address2) built.address2 = addr.address2;
    if (addr.city) built.city = addr.city;
    if (addr.zoneCode) built.zoneCode = addr.zoneCode;
    if (addr.zip) built.zip = addr.zip;
    return built;
  };

  for (const { node: loc } of locations) {
    // CompanyLocationUpdateInput only supports `phone` at the top level — not billingAddress/shippingAddress
    const updateInput = { phone };

    const result = await shopifyGraphQL(mutation, {
      companyLocationId: loc.id,
      input: updateInput,
    });

    if (!result.success) {
      console.warn(`⚠️ Failed to update phone on location ${loc.name} (${loc.id}):`, result.errors);
      continue;
    }

    const userErrors = result.data?.companyLocationUpdate?.userErrors || [];
    const isPhoneError = userErrors.some(err =>
      err.field?.some?.(f => f.toLowerCase().includes('phone')) ||
      err.message?.toLowerCase().includes('phone')
    );

    if (isPhoneError) {
      console.warn(
        `⚠️ Phone "${phone}" rejected by Shopify on location "${loc.name}".` +
        ` Requires E.164 format (e.g. +12025551234). Errors: ${userErrors.map(e => e.message).join(', ')}`
      );
    } else if (userErrors.length > 0) {
      console.warn(`⚠️ Errors updating phone on location "${loc.name}":`, userErrors);
    } else {
      console.log(`📞 Phone synced on location "${loc.name}" (${loc.id}): ${phone}`);
    }
  }
};

/**
 * Creates a company in Shopify from Salesforce Account data
 * @param {object} accountData - Transformed account data
 * @param {boolean} skipExisting - Skip if company already exists
 * @returns {object} - Result with company details or error
 */
export const createShopifyCompany = async (accountData, skipExisting = true) => {
  try {
    const {
      salesforceId,
      name,
      phone,
      description,
      billingAddress,
      shippingAddress,
      accountNumber,
      accountNumberCandelaOracle,
      type,
      industry,
      recordTypeName,
      ownerId,
      ownerName,
      parentName,
      region,
      accountActivityStatus,
      accountStatus,
      creditHold,
      payInAdvance,
      taxExempt,
      net30OnlineOrders,
      shopPriceBook,
      officeEmail,
      primaryOperatingUnit,
      createdById,
      createdDate,
      lastModifiedById,
      lastModifiedDate,
      latitude,
      longitude,
      legalOperatingAccountName,
      oracleCloudAccountNumber,
      oracleCustAccountId,
      oraclePartyId,
      speciality,
      subCategory,
      interfaceStatus,
      interfaceUpdate,
      billToAdditionalAddressInfo,
      billToAddressValidated,
      shipToAdditionalAddressInfo,
      shipToAddressValidated,
      taxId,
      vatNumber,
      vatRegistrationCountry,
      contacts,
      siteLocations,
      installedProductModels,
    } = accountData;

    const companyName = name || 'Unknown Company';

    // Check if company already exists
    if (skipExisting) {
      // First check by Salesforce ID (externalId)
      let existingCompany = null;
      let existingReason = null;

      if (salesforceId) {
        const existingById = await findCompanyBySalesforceId(salesforceId);
        if (existingById) {
          existingCompany = existingById;
          existingReason = 'Company already exists (matched by external ID)';
        }
      }

      if (existingCompany) {
        console.log(`⏭️ ${existingReason}: ${existingCompany.name} (${existingCompany.id})`);

        // Fetch roles and first location from existing company in one query
        let orderingOnlyRoleId = null;
        let existingLocationId = null;
        try {
          const companyInfoResult = await shopifyGraphQL(`
            query getCompanyInfo($companyId: ID!) {
              company(id: $companyId) {
                contactRoles(first: 10) {
                  edges { node { id name } }
                }
                locations(first: 1) {
                  edges { node { id name } }
                }
              }
            }
          `, { companyId: existingCompany.id });
          if (companyInfoResult.success) {
            const roles = (companyInfoResult.data.company?.contactRoles?.edges || []).map(e => e.node);
            const adminRole = (roles.find(r => r.name === 'Location admin') || roles.find(r => r.name === 'Admin') || roles[0]);
            orderingOnlyRoleId = roles.find(r => r.name === 'Ordering only')?.id || adminRole?.id;
            existingLocationId = companyInfoResult.data.company?.locations?.edges?.[0]?.node?.id || null;
            console.log(`  🔑 Roles — ordering-only: ${orderingOnlyRoleId}, location: ${existingLocationId}`);
          }
        } catch (infoErr) {
          console.warn(`  ⚠️ Could not fetch company roles/location:`, infoErr.message);
        }

        // Process contacts — create/update customers, assign to company, assign ordering role for new contacts
        const contactResults = { created: [], updated: [], failed: [] };
        if (contacts && contacts.length > 0) {
          console.log(`  👥 Processing ${contacts.length} contact(s) for existing company...`);
          for (const contact of contacts) {
            if (!contact.email) {
              console.log(`    ⏭️ Skipping contact ${contact.firstName || 'unknown'} (no email)`);
              continue;
            }
            const ensureResult = await ensureContactAssignedToCompany(existingCompany.id, {
              salesforceId: contact.salesforceId,
              firstName: contact.firstName || '',
              lastName: contact.lastName || '',
              salutation: contact.salutation || null,
              email: contact.email,
              phone: contact.phone,
              mobilePhone: contact.mobilePhone,
              title: contact.title || null,
              department: contact.department || null,
              accountId: salesforceId,
              accountName: companyName,
              recordTypeName: contact.recordTypeName,
              recordTypeId: contact.recordTypeId || null,
              mailingAdditionalInfo: contact.mailingAdditionalInfo || null,
              contactPurpose: contact.contactPurpose || null,
              contactStatus: contact.contactStatus || null,
              createdById: contact.createdById || null,
              createdDate: contact.createdDate || null,
              lastModifiedById: contact.lastModifiedById || null,
              lastModifiedDate: contact.lastModifiedDate || null,
              mailingAddress: contact.mailingAddress,
              installedProductModels: installedProductModels || [],
              mailOptOut: contact.mailOptOut === true,
              taxExempt: taxExempt === true,
              region: contact.region || null,
              speciality: contact.speciality || null,
            });
            if (ensureResult.success) {
              const isNew = ensureResult.status === 'created';
              console.log(`    ✅ ${isNew ? 'Created & attached' : 'Updated & linked'} ${contact.email}`);
              (isNew ? contactResults.created : contactResults.updated).push(contact.email);

              // Assign ordering-only role at existing location for newly created contacts
              if (isNew && ensureResult.companyContactId && orderingOnlyRoleId && existingLocationId) {
                const roleResult = await shopifyGraphQL(`
                  mutation companyContactAssignRole($companyContactId: ID!, $companyContactRoleId: ID!, $companyLocationId: ID!) {
                    companyContactAssignRole(companyContactId: $companyContactId, companyContactRoleId: $companyContactRoleId, companyLocationId: $companyLocationId) {
                      companyContactRoleAssignment { id }
                      userErrors { field message }
                    }
                  }
                `, {
                  companyContactId: ensureResult.companyContactId,
                  companyContactRoleId: orderingOnlyRoleId,
                  companyLocationId: existingLocationId,
                });
                const roleErrors = roleResult.data?.companyContactAssignRole?.userErrors || [];
                if (!roleResult.success || roleErrors.length > 0) {
                  console.warn(`    ⚠️ Role assignment failed for ${contact.email}:`, roleResult.errors || roleErrors);
                } else {
                  console.log(`    ✅ Ordering-only role assigned for ${contact.email}`);
                }
              }
            } else {
              console.warn(`    ⚠️ Failed for ${contact.email}:`, ensureResult.error);
              contactResults.failed.push(contact.email);
            }
          }
        }

        return {
          success: true,
          skipped: true,
          updated: true,
          reason: existingReason,
          existingCompanyId: existingCompany.id,
          name: existingCompany.name,
          salesforceId,
          contactResults,
        };
      }
    }

    console.log(`🏢 Creating company: ${companyName} (${salesforceId})`);

    // Build metafields array
    const metafields = [];

    const metafieldMap = {
      salesforce_account_id: salesforceId,
      account_number: accountNumber,
      account_number_candela_oracle: accountNumberCandelaOracle,
      account_type: type,
      industry: industry,
      record_type_name: recordTypeName,
      owner_id: ownerId,
      owner_name: ownerName,
      parent_name: parentName,
      region: region,
      account_activity_status: accountActivityStatus,
      account_status: accountStatus,
      credit_hold: creditHold != null ? String(creditHold) : null,
      pay_in_advance: payInAdvance != null ? String(payInAdvance) : null,
      tax_exempt: taxExempt != null ? String(taxExempt) : null,
      net30_online_orders: net30OnlineOrders != null ? String(net30OnlineOrders) : null,
      shop_price_book: shopPriceBook,
      office_email: officeEmail,
      primary_operating_unit: primaryOperatingUnit,
      phone: phone,
      created_by_id: createdById,
      created_date: createdDate ? (typeof createdDate === 'string' ? createdDate : new Date(createdDate).toISOString()) : null,
      last_modified_by_id: lastModifiedById,
      last_modified_date: lastModifiedDate ? (typeof lastModifiedDate === 'string' ? lastModifiedDate : new Date(lastModifiedDate).toISOString()) : null,
      latitude: latitude,
      longitude: longitude,
      legal_operating_account_name: legalOperatingAccountName,
      oracle_cloud_account_number: oracleCloudAccountNumber,
      oracle_cust_account_id: oracleCustAccountId,
      oracle_party_id: oraclePartyId,
      speciality: speciality,
      sub_category: subCategory,
      interface_status: interfaceStatus,
      interface_update: interfaceUpdate,
      bill_to_additional_address_info: billToAdditionalAddressInfo,
      bill_to_address_validated: billToAddressValidated,
      ship_to_additional_address_info: shipToAdditionalAddressInfo,
      ship_to_address_validated: shipToAddressValidated,
      tax_id: taxId,
      vat_number: vatNumber,
      vat_registration_country: vatRegistrationCountry,
    };

    for (const [key, value] of Object.entries(metafieldMap)) {
      if (value != null && value !== '') {
        metafields.push({
          namespace: COMPANY_METAFIELD_NAMESPACE,
          key,
          value: String(value),
          type: 'single_line_text_field',
        });
      }
    }

    // Resolve country code for market creation — does not go on the location.
    // Site locations with full addresses are added separately via /sync-locations.
    const resolvedCountryCode =
      getCountryCodeFromRegion(region, billingAddress?.countryCode, billingAddress?.country) ||
      getCountryCodeFromRegion(region, shippingAddress?.countryCode, shippingAddress?.country) ||
      'US';
    console.log(`  🌍 Resolved country: ${resolvedCountryCode} (region: ${region || 'none'})`);

    // Sanitize an address string: remove control chars/newlines, collapse spaces, trim
    const sanitizeAddressField = (val) => {
      if (!val) return null;
      return val
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // control characters → space
        .replace(/\s+/g, ' ')               // collapse multiple spaces
        .trim();
    };

    // Build billing and shipping address for the primary company location
    const buildCompanyAddress = (addr) => {
      if (!addr) return null;
      const cc = getCountryCodeFromRegion(region, addr.countryCode, addr.country);
      if (!cc) return null;
      const built = { countryCode: cc };
      const cleanStreet = sanitizeAddressField(addr.street);
      if (cleanStreet) built.address1 = cleanStreet;
      if (addr.additionalInfo) built.address2 = sanitizeAddressField(addr.additionalInfo) || undefined;
      if (addr.city) built.city = addr.city;
      if (addr.postalCode) built.zip = addr.postalCode;
      if (addr.stateCode || addr.state) built.zoneCode = addr.stateCode || addr.state;
      if (phone) built.phone = phone;
      return built;
    };

    const builtBillingAddress = buildCompanyAddress(billingAddress);
    const builtShippingAddress = buildCompanyAddress(shippingAddress);

    const companyLocation = { name: companyName };
    if (builtBillingAddress) companyLocation.billingAddress = builtBillingAddress;
    if (builtShippingAddress) companyLocation.shippingAddress = builtShippingAddress;

    // Build mutation
    const mutation = `
      mutation companyCreate($input: CompanyCreateInput!) {
        companyCreate(input: $input) {
          company {
            id
            name
            externalId
            note
            locations(first: 1) {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const companyInput = {
      company: {
        name: companyName,
        externalId: salesforceId || undefined,
        note: description || undefined,
      },
      companyLocation: {
        ...companyLocation,
        taxExempt: taxExempt === true || taxExempt === 'true' ? true : false,
      },
    };

    let result = await shopifyGraphQL(mutation, { input: companyInput });

    if (!result.success) {
      console.error(`❌ Failed to create company ${companyName}:`, result.errors);
      return { success: false, salesforceId, name: companyName, errors: result.errors };
    }

    let userErrors = result.data.companyCreate.userErrors;

    // Phone invalid — strip from addresses, save raw value, and retry
    const hasPhoneError = (errors) => errors && errors.some(e =>
      e.field && e.field.some(f => f === 'phone') && e.message?.toLowerCase().includes('invalid')
    );

    if (hasPhoneError(userErrors) && phone) {
      console.warn(`⚠️ Phone "${phone}" invalid for company "${companyName}" — retrying without phone, saving to metafield`);

      // Save the raw phone to metafields so it's not lost
      metafields.push({
        namespace: 'salesforce',
        key: 'phone',
        value: String(phone),
        type: 'single_line_text_field',
      });

      // Strip phone from both addresses
      if (companyInput.companyLocation.billingAddress) {
        delete companyInput.companyLocation.billingAddress.phone;
      }
      if (companyInput.companyLocation.shippingAddress) {
        delete companyInput.companyLocation.shippingAddress.phone;
      }

      result = await shopifyGraphQL(mutation, { input: companyInput });
      if (!result.success) {
        console.error(`❌ Failed to create company ${companyName} (retry no phone):`, result.errors);
        return { success: false, salesforceId, name: companyName, errors: result.errors };
      }
      userErrors = result.data.companyCreate.userErrors;
    }

    // address1 still invalid after sanitization — save raw value to metafield and omit from address
    const hasAddress1Error = (errors) => errors && errors.some(e =>
      e.field && e.field.some(f => f === 'address1')
    );

    if (hasAddress1Error(userErrors)) {
      console.warn(`⚠️ Address1 still rejected for company "${companyName}" after sanitization — saving raw to metafield, retrying without address1`);

      const billingStreet = billingAddress?.street;
      const shippingStreet = shippingAddress?.street;

      if (billingStreet) {
        metafields.push({ namespace: 'salesforce', key: 'billing_street', value: String(billingStreet), type: 'single_line_text_field' });
        if (companyInput.companyLocation.billingAddress) delete companyInput.companyLocation.billingAddress.address1;
      }
      if (shippingStreet) {
        metafields.push({ namespace: 'salesforce', key: 'shipping_street', value: String(shippingStreet), type: 'single_line_text_field' });
        if (companyInput.companyLocation.shippingAddress) delete companyInput.companyLocation.shippingAddress.address1;
      }

      // If shipping address now has no address1, Shopify requires it — omit the whole shipping address
      if (companyInput.companyLocation.shippingAddress && !companyInput.companyLocation.shippingAddress.address1) {
        console.warn(`  ⚠️ Omitting shippingAddress entirely (no valid address1)`);
        delete companyInput.companyLocation.shippingAddress;
      }
      if (companyInput.companyLocation.billingAddress && !companyInput.companyLocation.billingAddress.address1) {
        console.warn(`  ⚠️ Omitting billingAddress entirely (no valid address1)`);
        delete companyInput.companyLocation.billingAddress;
      }

      result = await shopifyGraphQL(mutation, { input: companyInput });
      if (!result.success) {
        console.error(`❌ Failed to create company ${companyName} (retry no address1):`, result.errors);
        return { success: false, salesforceId, name: companyName, errors: result.errors };
      }
      userErrors = result.data.companyCreate.userErrors;
    }

    if (userErrors && userErrors.length > 0) {
      console.error(`❌ Company creation errors for ${companyName}:`, userErrors);
      return { success: false, salesforceId, name: companyName, errors: userErrors };
    }

    const company = result.data.companyCreate.company;
    const locationId = company.locations?.edges?.[0]?.node?.id || null;
    console.log(`✅ Company created: ${company.name} (${company.id})`);

    // Set metafields via metafieldsSet (CompanyInput does not support inline metafields)
    // Shopify limits metafieldsSet to 25 per call — batch accordingly
    if (metafields.length > 0) {
      const metafieldsMutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const metafieldsInput = metafields.map(mf => ({
        ownerId: company.id,
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type,
      }));

      const BATCH_SIZE = 25;
      let totalSet = 0;
      for (let i = 0; i < metafieldsInput.length; i += BATCH_SIZE) {
        const batch = metafieldsInput.slice(i, i + BATCH_SIZE);
        const mfResult = await shopifyGraphQL(metafieldsMutation, { metafields: batch });

        if (!mfResult.success || mfResult.data?.metafieldsSet?.userErrors?.length > 0) {
          const mfErrors = mfResult.errors || mfResult.data?.metafieldsSet?.userErrors;
          console.warn(`⚠️ Company metafields batch ${Math.floor(i / BATCH_SIZE) + 1} had errors:`, mfErrors);
        } else {
          totalSet += batch.length;
        }
      }
      console.log(`  📝 Set ${totalSet}/${metafieldsInput.length} metafields on company`);
    }

    // Set installed product models as a list metafield (custom.installed_product_model)
    if (installedProductModels && installedProductModels.length > 0) {
      console.log(`  🔧 Setting ${installedProductModels.length} installed product model(s) on company...`);

      const listMetafieldMutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const listMfResult = await shopifyGraphQL(listMetafieldMutation, {
        metafields: [{
          ownerId: company.id,
          namespace: 'custom',
          key: 'installed_product_model',
          value: JSON.stringify(installedProductModels),
          type: 'list.single_line_text_field',
        }],
      });

      const listMfErrors = listMfResult.data?.metafieldsSet?.userErrors || [];
      if (!listMfResult.success || listMfErrors.length > 0) {
        console.warn(`  ⚠️ Failed to set installed_product_model metafield:`, listMfResult.errors || listMfErrors);
      } else {
        console.log(`  ✅ Set installed_product_model: [${installedProductModels.join(', ')}]`);
      }
    }

    // Build buyer experience config (reused for all locations)
    const buyerConfig = {
      editableShippingAddress: true,
      checkoutToDraft: false,
    };

    // Look up Net 30 payment terms template if account qualifies
    const isNet30 = net30OnlineOrders && String(net30OnlineOrders).toLowerCase() === 'true';
    console.log(`  🔍 Net 30 field value: "${net30OnlineOrders}" → isNet30: ${isNet30}`);

    if (isNet30) {
      try {
        const templatesQuery = `
          query {
            paymentTermsTemplates {
              id
              name
              paymentTermsType
              dueInDays
            }
          }
        `;

        const templatesResult = await shopifyGraphQL(templatesQuery);

        if (templatesResult.success) {
          const allTemplates = templatesResult.data.paymentTermsTemplates || [];
          console.log(`  📋 Available payment terms templates (${allTemplates.length}):`);
          allTemplates.forEach(t => console.log(`     - ${t.name} | ${t.dueInDays} days | type: ${t.paymentTermsType} | id: ${t.id}`));

          const net30Template = allTemplates.find(
            t => (t.paymentTermsType === 'NET' && Number(t.dueInDays) === 30) || t.name === 'Net 30'
          );

          if (net30Template) {
            buyerConfig.paymentTermsTemplateId = net30Template.id;
            console.log(`  ✅ Matched Net 30 template: ${net30Template.id}`);
          } else {
            console.warn(`  ⚠️ No template matched Net 30. Check template names above.`);
          }
        } else {
          console.warn(`  ⚠️ paymentTermsTemplates query failed:`, templatesResult.errors);
        }
      } catch (ptError) {
        console.warn(`  ⚠️ Error looking up payment terms:`, ptError.message);
      }
    }

    // Helper: apply buyer config to a company location (delegates to module-level function)
    const applyBuyerConfigToLocation = (locId, label) =>
      applyLocationBuyerConfig(locId, label, buyerConfig, phone);

    // Apply buyer config to the primary location
    if (locationId) {
      await applyBuyerConfigToLocation(locationId, 'Primary location');
    }

    // Ensure a Shopify market exists for the company's country
    try {
      const countryNames = {
        US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia',
        JP: 'Japan', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy',
        NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria',
        NZ: 'New Zealand', SG: 'Singapore', HK: 'Hong Kong', TW: 'Taiwan',
        KR: 'South Korea', CN: 'China', IN: 'India', BR: 'Brazil', MX: 'Mexico',
        IL: 'Israel', AE: 'United Arab Emirates', SA: 'Saudi Arabia',
      };
      await ensureMarketForCountry(resolvedCountryCode, countryNames[resolvedCountryCode] || resolvedCountryCode);
    } catch (marketError) {
      console.warn(`  ⚠️ Error ensuring market for ${resolvedCountryCode}:`, marketError.message);
    }

    // Hoisted so site location creation can also use these
    let adminRoleId = null;
    let orderingOnlyRoleId = null;
    let mainCompanyContactId = null;
    let emailMatchedContact = null;
    let primaryCompanyContactId = null;
    let firstCompanyContactId = null;
    let reconciliationMismatch = null;
    const locationErrors = [];
    const allCompanyContactIds = [];
    const MAX_CONTACTS_PER_LOCATION = 50;

    // Attach contacts and set primary if account is Active
    const attachedEmails = new Set(); // tracks emails successfully attached to Shopify

    if (contacts && contacts.length > 0 && locationId) {
      console.log(`  👥 Attaching ${contacts.length} contact(s) to company...`);

      // Fetch available company contact roles from the newly created company
      try {
        const rolesQuery = `
          query getCompanyRoles($companyId: ID!) {
            company(id: $companyId) {
              contactRoles(first: 10) {
                edges {
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        `;
        const rolesResult = await shopifyGraphQL(rolesQuery, { companyId: company.id });
        if (rolesResult.success && rolesResult.data.company?.contactRoles?.edges?.length > 0) {
          const roles = rolesResult.data.company.contactRoles.edges.map(e => e.node);
          adminRoleId = (
            roles.find(r => r.name === 'Location admin') ||
            roles.find(r => r.name === 'Admin') ||
            roles.find(r => r.name === 'Location manager') ||
            roles[0]
          )?.id;
          orderingOnlyRoleId = roles.find(r => r.name === 'Ordering only')?.id || adminRoleId;
          console.log(`  🔑 Roles — admin: ${adminRoleId}, ordering-only: ${orderingOnlyRoleId}`);
        }
      } catch (roleErr) {
        console.warn(`  ⚠️ Could not fetch company contact roles:`, roleErr.message);
      }

      // Determine main contact: prefer contact whose email matches account's officeEmail
      emailMatchedContact = officeEmail
        ? contacts.find(c => c.email && c.email.toLowerCase() === officeEmail.toLowerCase())
        : null;

      // Pre-determine the main contact email using all three tiers so the primary
      // location role assignment is consistent with how site locations pick the admin:
      //   1. Email match with officeEmail
      //   2. Fallback to primary flag
      //   3. Fallback to first contact that has an email
      let resolvedMainContactEmail = null;
      if (emailMatchedContact) {
        resolvedMainContactEmail = emailMatchedContact.email.toLowerCase();
        console.log(`  ⭐ Main contact pre-selected by email match: ${emailMatchedContact.email}`);
      } else {
        const primaryFlagContact = contacts.find(c => c.email && c.primary);
        const firstEmailContact = contacts.find(c => c.email);
        const fallback = primaryFlagContact || firstEmailContact;
        if (fallback) {
          resolvedMainContactEmail = fallback.email.toLowerCase();
          console.log(`  ⭐ No officeEmail match — main contact resolved to: ${fallback.email} (${primaryFlagContact ? 'primary flag' : 'first contact'})`);
        } else {
          console.log(`  ⭐ No contact matched officeEmail (${officeEmail || 'none'}) — will fall back to primary/first contact`);
        }
      }

      let currentLocationId = locationId;
      let locationGroupNumber = 1;

      let roleAssignmentCount = 0;
      if (currentLocationId) {
        try {
          const countResult = await shopifyGraphQL(`
            query locationContactCount($locationId: ID!) {
              companyLocation(id: $locationId) {
                roleAssignments(first: 50) {
                  nodes { id }
                  pageInfo { hasNextPage }
                }
              }
            }
          `, { locationId: currentLocationId });
          const ra = countResult.data?.companyLocation?.roleAssignments;
          if (ra) {
            roleAssignmentCount = ra.pageInfo?.hasNextPage ? MAX_CONTACTS_PER_LOCATION : (ra.nodes?.length || 0);
            if (roleAssignmentCount > 0) console.log(`    ℹ️  Location already has ${roleAssignmentCount}${ra.pageInfo?.hasNextPage ? '+' : ''} role assignment(s)`);
          }
        } catch (_) {
          // Non-fatal — fall back to 0
        }
      }

      for (const contact of contacts) {
        if (!contact.email) {
          console.log(`    ⏭️ Skipping contact ${contact.firstName || contact.name || 'unknown'} (no email)`);
          continue;
        }

        let companyContactId = null;

        const ensureResult = await ensureContactAssignedToCompany(company.id, {
          salesforceId: contact.salesforceId,
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          salutation: contact.salutation || null,
          email: contact.email,
          phone: contact.phone,
          mobilePhone: contact.mobilePhone,
          title: contact.title || null,
          department: contact.department || null,
          accountId: salesforceId,
          accountName: companyName,
          recordTypeName: contact.recordTypeName,
          recordTypeId: contact.recordTypeId || null,
          mailingAdditionalInfo: contact.mailingAdditionalInfo || null,
          contactPurpose: contact.contactPurpose || null,
          contactStatus: contact.contactStatus || null,
          createdById: contact.createdById || null,
          createdDate: contact.createdDate || null,
          lastModifiedById: contact.lastModifiedById || null,
          lastModifiedDate: contact.lastModifiedDate || null,
          mailingAddress: contact.mailingAddress,
          installedProductModels: installedProductModels || [],
          mailOptOut: contact.mailOptOut === true,
          taxExempt: taxExempt === true,
          region: contact.region || null,
          speciality: contact.speciality || null,
        });

        if (!ensureResult.success) {
          console.warn(`    ⚠️ Failed to ensure contact ${contact.email}:`, ensureResult.error);
          continue;
        }

        companyContactId = ensureResult.companyContactId;
        if (companyContactId) {
          allCompanyContactIds.push(companyContactId);
          attachedEmails.add(contact.email.toLowerCase());
        }
        const isNew = ensureResult.status === 'created';
        console.log(`    ✅ ${isNew ? 'Created & attached' : 'Updated & linked'} ${contact.email} to company`);

        const isMainContact = resolvedMainContactEmail
          ? contact.email?.toLowerCase() === resolvedMainContactEmail
          : false;

        if (adminRoleId) {
          const roleMutation = `
            mutation companyContactAssignRole($companyContactId: ID!, $companyContactRoleId: ID!, $companyLocationId: ID!) {
              companyContactAssignRole(companyContactId: $companyContactId, companyContactRoleId: $companyContactRoleId, companyLocationId: $companyLocationId) {
                companyContactRoleAssignment { id }
                userErrors { field message }
              }
            }
          `;

          const createGroupLocation = async () => {
            locationGroupNumber++;
            const newLocationName = `${companyName} - Group ${locationGroupNumber}`;
            console.log(`    📍 Location full (${MAX_CONTACTS_PER_LOCATION}) — creating "${newLocationName}"...`);
            const createLocMutation = `
              mutation companyLocationCreate($companyId: ID!, $input: CompanyLocationInput!) {
                companyLocationCreate(companyId: $companyId, input: $input) {
                  companyLocation { id name }
                  userErrors { field message }
                }
              }
            `;
            const newLocInput = { name: newLocationName };
            if (companyLocation.billingAddress) {
              newLocInput.billingAddress = companyLocation.billingAddress;
              newLocInput.shippingAddress = companyLocation.shippingAddress;
            }
            const newLocResult = await shopifyGraphQL(createLocMutation, { companyId: company.id, input: newLocInput });
            if (newLocResult.success && !newLocResult.data.companyLocationCreate.userErrors?.length) {
              currentLocationId = newLocResult.data.companyLocationCreate.companyLocation.id;
              roleAssignmentCount = 0;
              console.log(`    📍 Created group location: ${newLocationName} (${currentLocationId})`);
              await applyBuyerConfigToLocation(currentLocationId, newLocationName);
              return true;
            }
            console.warn(`    ⚠️ Failed to create group location:`, newLocResult.errors || newLocResult.data.companyLocationCreate.userErrors);
            return false;
          };

          if (roleAssignmentCount >= MAX_CONTACTS_PER_LOCATION) {
            await createGroupLocation();
          }

          const roleForContact = isMainContact ? adminRoleId : (orderingOnlyRoleId || adminRoleId);
          const roleLabel = isMainContact ? 'Location admin' : 'Ordering only';

          let roleResult = await shopifyGraphQL(roleMutation, {
            companyContactId,
            companyContactRoleId: roleForContact,
            companyLocationId: currentLocationId,
          });

          const isMaxError = (res) => {
            const errs = [
              ...(Array.isArray(res.errors) ? res.errors : []),
              ...(Array.isArray(res.data?.companyContactAssignRole?.userErrors) ? res.data.companyContactAssignRole.userErrors : []),
            ];
            return errs.some(e => e.message?.includes('maximum number'));
          };

          if (isMaxError(roleResult)) {
            console.warn(`    ⚠️ Location full for ${contact.email} — creating group and retrying...`);
            const created = await createGroupLocation();
            if (created) {
              roleResult = await shopifyGraphQL(roleMutation, {
                companyContactId,
                companyContactRoleId: roleForContact,
                companyLocationId: currentLocationId,
              });
            }
          }

          if (roleResult.success && !roleResult.data.companyContactAssignRole.userErrors?.length) {
            roleAssignmentCount++;
            console.log(`    🔑 ${contact.email} → ${roleLabel} (${roleAssignmentCount}/${MAX_CONTACTS_PER_LOCATION})`);
          } else {
            const roleErrors = roleResult.errors || roleResult.data.companyContactAssignRole.userErrors || [];
            const alreadyAssigned = roleErrors.some(e => e.message?.includes('already been assigned'));
            if (alreadyAssigned) {
              roleAssignmentCount++;
              console.log(`    🔑 ${contact.email} → ${roleLabel} (already assigned)`);
            } else {
              console.warn(`    ⚠️ Role assignment failed for ${contact.email}:`, roleErrors);
            }
          }
        }

        // Track main contact for companyAssignMainContact
        if (emailMatchedContact) {
          // New logic: email match takes priority
          if (contact.email?.toLowerCase() === officeEmail?.toLowerCase()) {
            primaryCompanyContactId = companyContactId;
            mainCompanyContactId = companyContactId;
          }
        } else {
          // Fallback: use primary flag
          if (contact.primary) {
            primaryCompanyContactId = companyContactId;
            mainCompanyContactId = companyContactId;
          }
        }

        // Track first successfully attached contact as fallback for main contact
        if (!firstCompanyContactId) {
          firstCompanyContactId = companyContactId;
          if (!mainCompanyContactId) mainCompanyContactId = companyContactId;
        }
      }

      // ── Reconciliation: Salesforce active+email contacts vs Shopify attached ──
      const sfEmailContacts = contacts.filter(c => c.email);
      const sfContactCount = sfEmailContacts.length;
      const shopifyAttachedCount = allCompanyContactIds.length;
      if (shopifyAttachedCount === sfContactCount) {
        console.log(`  ✅ Contact reconciliation OK: ${shopifyAttachedCount}/${sfContactCount} active+email contacts attached`);
      } else {
        const missing = sfEmailContacts.filter(c => !attachedEmails.has(c.email.toLowerCase()));
        console.warn(`  ⚠️  Contact reconciliation MISMATCH for "${companyName}": Salesforce ${sfContactCount} active+email contacts → Shopify attached ${shopifyAttachedCount}`);
        if (missing.length > 0) {
          console.warn(`    Not attached (${missing.length}): ${missing.map(c => c.email).join(', ')}`);
        }
        reconciliationMismatch = {
          accountName: companyName,
          salesforceId,
          sfCount: sfContactCount,
          shopifyCount: shopifyAttachedCount,
          missingEmails: missing.map(c => c.email),
        };
      }

      // Set main contact: prefer primary, fall back to first attached contact
      const mainContactId = primaryCompanyContactId || firstCompanyContactId;
      if (mainContactId) {
        const mainContactMutation = `
          mutation companyAssignMainContact($companyId: ID!, $companyContactId: ID!) {
            companyAssignMainContact(companyId: $companyId, companyContactId: $companyContactId) {
              company {
                id
                mainContact {
                  id
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const mcResult = await shopifyGraphQL(mainContactMutation, {
          companyId: company.id,
          companyContactId: mainContactId,
        });

        const mainLabel = emailMatchedContact
          ? `email-matched (${emailMatchedContact.email})`
          : primaryCompanyContactId ? 'primary flag' : 'first attached contact';
        if (mcResult.success && !mcResult.data.companyAssignMainContact.userErrors?.length) {
          console.log(`  ⭐ Set main contact via ${mainLabel}`);
        } else {
          const mcErrors = mcResult.errors || mcResult.data.companyAssignMainContact.userErrors;
          console.warn(`  ⚠️ Failed to set main contact:`, mcErrors);
        }
      }
    }

    // Site location creation has been moved to the /sync-locations API.
    // Call POST /api/accounts/sync-locations after companies are created.

    const mainContactReportEntry = (contacts && contacts.length > 0) ? {
      accountName: companyName,
      officeEmail: officeEmail || '',
      mainContactEmail: emailMatchedContact?.email || (primaryCompanyContactId ? contacts.find(c => c.primary)?.email : null) || contacts[0]?.email || '',
      source: emailMatchedContact ? 'Email match (officeEmail)' : (contacts.find(c => c.primary) ? 'Fallback: primary flag' : 'Fallback: first contact'),
    } : null;

    return {
      success: true,
      salesforceId,
      shopifyCompanyId: company.id,
      shopifyLocationId: locationId,
      name: company.name,
      mainContactReport: mainContactReportEntry,
      reconciliationMismatch,
      locationErrors,
    };

  } catch (error) {
    console.error(`❌ Error creating company:`, error.message);
    return {
      success: false,
      salesforceId: accountData.salesforceId,
      error: error.message,
    };
  }
};

/**
 * Batch create companies from Salesforce accounts
 * @param {array} accounts - Array of transformed account data
 * @param {number} delayBetween - Delay between creations in ms
 * @param {boolean} skipExisting - Skip existing companies
 * @returns {object} - Results summary
 */
export const createShopifyCompaniesBatch = async (accounts, delayBetween = 500, skipExisting = true) => {
  const results = {
    successful: [],
    failed: [],
    skipped: [],
  };

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log(`\n[${i + 1}/${accounts.length}] Processing: ${account.name} (${account.salesforceId})`);

    const result = await createShopifyCompany(account, skipExisting);

    if (result.skipped) {
      results.skipped.push(result);
    } else if (result.success) {
      results.successful.push(result);
    } else {
      results.failed.push(result);
    }

    // Delay between API calls
    if (i < accounts.length - 1 && delayBetween > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetween));
    }
  }

  console.log(`\n📊 Batch complete: ✅ ${results.successful.length} | ❌ ${results.failed.length} | ⏭️ ${results.skipped.length}`);

  return results;
};

/**
 * Syncs Salesforce site locations to an already-created Shopify company.
 * Finds the company by Salesforce ID, fetches its existing contacts/roles from Shopify,
 * creates each site location, and assigns all contacts to the new locations.
 * Skips locations that already exist by name (idempotent).
 *
 * @param {object} accountData - Transformed account data (needs salesforceId, name, region, siteLocations, net30OnlineOrders)
 * @returns {object} - Result with locationsCreated, locationsSkipped, locationErrors
 */
export const syncSiteLocationsForCompany = async (accountData) => {
  const { salesforceId, name, region, siteLocations, net30OnlineOrders } = accountData;

  try {
    if (!siteLocations || siteLocations.length === 0) {
      console.log(`  ℹ️  No site locations to sync for "${name}"`);
      return { success: true, salesforceId, name, locationsCreated: [], locationsSkipped: [], locationErrors: [] };
    }

    // Find the Shopify company by Salesforce externalId
    const company = await findCompanyBySalesforceId(salesforceId);
    if (!company) {
      console.error(`  ❌ Company not found in Shopify for SF ID ${salesforceId} — run /sync-to-shopify first`);
      return { success: false, salesforceId, name, error: `Company not found in Shopify (externalId: ${salesforceId}) — run sync-to-shopify first` };
    }

    console.log(`  🏢 Found company: ${company.name} (${company.id})`);

    // Fetch company contacts, contact roles, and first page of locations
    const detailsQuery = `
      query getCompanyDetails($id: ID!) {
        company(id: $id) {
          mainContact { id }
          contacts(first: 250) {
            edges { node { id } }
          }
          contactRoles(first: 10) {
            edges { node { id name } }
          }
          locations(first: 250) {
            edges { node { id name externalId } cursor }
            pageInfo { hasNextPage }
          }
        }
      }
    `;

    const detailsResult = await shopifyGraphQL(detailsQuery, { id: company.id });
    if (!detailsResult.success || !detailsResult.data?.company) {
      return { success: false, salesforceId, name, error: 'Failed to fetch company details from Shopify' };
    }

    const companyData = detailsResult.data.company;
    const allCompanyContactIds = companyData.contacts.edges.map(e => e.node.id);
    const mainCompanyContactId = companyData.mainContact?.id || null;

    // Collect all existing locations — paginate if company has more than 250
    let allExistingLocations = companyData.locations.edges.map(e => e.node);
    if (companyData.locations.pageInfo?.hasNextPage) {
      const locPageQuery = `
        query getCompanyLocationsPage($id: ID!, $after: String) {
          company(id: $id) {
            locations(first: 250, after: $after) {
              edges { node { id name externalId } cursor }
              pageInfo { hasNextPage }
            }
          }
        }
      `;
      let locCursor = companyData.locations.edges[companyData.locations.edges.length - 1]?.cursor;
      let locHasNext = true;
      while (locHasNext && locCursor) {
        const locPage = await shopifyGraphQL(locPageQuery, { id: company.id, after: locCursor });
        if (!locPage.success) break;
        const locEdges = locPage.data.company?.locations?.edges || [];
        locHasNext = locPage.data.company?.locations?.pageInfo?.hasNextPage || false;
        allExistingLocations = [...allExistingLocations, ...locEdges.map(e => e.node)];
        locCursor = locEdges.length > 0 ? locEdges[locEdges.length - 1].cursor : null;
      }
    }

    // Primary check: Salesforce site ID stored as externalId (immune to name casing differences).
    const existingLocationExternalIds = new Set(
      allExistingLocations.map(l => l.externalId).filter(Boolean)
    );

    const roles = companyData.contactRoles.edges.map(e => e.node);
    const adminRoleId = (
      roles.find(r => r.name === 'Location admin') ||
      roles.find(r => r.name === 'Admin') ||
      roles.find(r => r.name === 'Location manager') ||
      roles[0]
    )?.id;
    const orderingOnlyRoleId = roles.find(r => r.name === 'Ordering only')?.id || adminRoleId;

    console.log(`  📇 Contacts to assign: ${allCompanyContactIds.length} | Existing locations: ${allExistingLocations.length} (${existingLocationExternalIds.size} with externalId)`);

    // Build buyer config (payment terms + editable shipping)
    const buyerConfig = { editableShippingAddress: true, checkoutToDraft: false };
    const isNet30 = net30OnlineOrders && String(net30OnlineOrders).toLowerCase() === 'true';

    if (isNet30) {
      try {
        const templatesResult = await shopifyGraphQL(`
          query { paymentTermsTemplates { id name paymentTermsType dueInDays } }
        `);
        if (templatesResult.success) {
          const allTemplates = templatesResult.data.paymentTermsTemplates || [];
          const net30Template = allTemplates.find(
            t => (t.paymentTermsType === 'NET' && Number(t.dueInDays) === 30) || t.name === 'Net 30'
          );
          if (net30Template) {
            buyerConfig.paymentTermsTemplateId = net30Template.id;
            console.log(`  ✅ Net 30 payment terms template: ${net30Template.id}`);
          }
        }
      } catch (ptError) {
        console.warn(`  ⚠️ Error looking up payment terms:`, ptError.message);
      }
    }

    const applyBuyerConfigToLocation = (locId, label) =>
      applyLocationBuyerConfig(locId, label, buyerConfig, null);

    const createSiteLocationMutation = `
      mutation companyLocationCreate($companyId: ID!, $input: CompanyLocationInput!) {
        companyLocationCreate(companyId: $companyId, input: $input) {
          companyLocation { id name }
          userErrors { field message }
        }
      }
    `;

    const roleMutation = `
      mutation companyContactAssignRole($companyContactId: ID!, $companyContactRoleId: ID!, $companyLocationId: ID!) {
        companyContactAssignRole(companyContactId: $companyContactId, companyContactRoleId: $companyContactRoleId, companyLocationId: $companyLocationId) {
          companyContactRoleAssignment { id }
          userErrors { field message }
        }
      }
    `;

    const MAX_CONTACTS_PER_LOCATION = 50;
    const locationsCreated = [];
    const locationsSkipped = [];
    const locationErrors = [];

    const ALLOWED_LOCATION_COUNTRY_CODES = new Set(['US']);

    for (const site of siteLocations) {
      // Country validation — skip locations outside allowed countries or with no country
      const siteCountryCode = getCountryCodeFromRegion(region, null, site.address.country);
      if (!siteCountryCode || !ALLOWED_LOCATION_COUNTRY_CODES.has(siteCountryCode)) {
        console.log(`    ⏭️  Location "${site.name}" skipped — country "${site.address.country || 'none'}" (resolved: ${siteCountryCode || 'null'}) not allowed`);
        locationsSkipped.push(site.name);
        continue;
      }

      // Idempotency: skip only if externalId matches an existing Shopify location.
      if (site.salesforceId && existingLocationExternalIds.has(site.salesforceId)) {
        console.log(`    ⏭️  Location "${site.name}" already exists (externalId: ${site.salesforceId}) — skipping`);
        locationsSkipped.push(site.name);
        continue;
      }

      console.log(`    📍 Creating site location: "${site.name}"`);

      // ── Sanitize helpers ──────────────────────────────────────────────────────
      const sanitizeStr = (val) => val
        ? val.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim()
        : null;

      // US zip: keep only digits and hyphens, must be at least 5 digits
      const sanitizeZip = (val) => {
        if (!val) return null;
        const cleaned = val.replace(/[^\d-]/g, '').trim();
        return /^\d{5}/.test(cleaned) ? cleaned : null;
      };

      // Zone code: only use if it looks like a real code (≤ 3 chars, alphanumeric only)
      // Full state names (e.g. "California") are rejected by Shopify
      const sanitizeZoneCode = (code) => {
        if (!code) return null;
        const c = code.trim();
        return /^[A-Za-z0-9]{1,3}$/.test(c) ? c.toUpperCase() : null;
      };

      // Build address
      const hasAddress = site.address.street || site.address.city || site.address.postalCode || site.address.country;
      let builtAddr = null;

      if (hasAddress) {
        const cc = getCountryCodeFromRegion(region, null, site.address.country);
        if (cc) {
          const cleanStreet = sanitizeStr(site.address.street);
          const cleanZip = sanitizeZip(site.address.postalCode);
          const cleanZoneCode = sanitizeZoneCode(site.address.stateCode || site.address.state);

          builtAddr = { countryCode: cc };
          if (cleanStreet) builtAddr.address1 = cleanStreet;
          const cleanAddr2 = sanitizeStr(site.address.additionalInfo);
          if (cleanAddr2) builtAddr.address2 = cleanAddr2;
          if (site.address.city) builtAddr.city = site.address.city;
          if (cleanZoneCode) builtAddr.zoneCode = cleanZoneCode;
          if (cleanZip) builtAddr.zip = cleanZip;
          if (site.phone) builtAddr.phone = site.phone;
        } else {
          console.warn(`    ⚠️  No country code for "${site.name}" (country: "${site.address.country}", region: "${region}") — creating without address`);
        }
      }

      const assignAddr = (input, addr) => {
        if (!addr) return;
        if (site.isBillTo && site.isShipTo) {
          input.billingAddress = { ...addr };
          input.shippingAddress = { ...addr };
        } else if (site.isBillTo) {
          input.billingAddress = { ...addr };
        } else if (site.isShipTo) {
          input.shippingAddress = { ...addr };
        } else {
          input.shippingAddress = { ...addr };
        }
      };

      const siteLocInput = {
        name: site.name,
        buyerExperienceConfiguration: { editableShippingAddress: true },
      };
      assignAddr(siteLocInput, builtAddr);

      // ── Retry helper ──────────────────────────────────────────────────────────
      const hasFieldErr = (errors, field) => errors?.some(
        e => e.field?.some(f => f.toLowerCase().includes(field)) || e.message?.toLowerCase().includes(field)
      );

      const dropAddrField = (input, field) => {
        if (input.billingAddress) delete input.billingAddress[field];
        if (input.shippingAddress) delete input.shippingAddress[field];
      };

      const retryLocation = async () =>
        shopifyGraphQL(createSiteLocationMutation, { companyId: company.id, input: siteLocInput });

      let siteLocResult = await retryLocation();

      if (siteLocResult.success) {
        let errs = siteLocResult.data.companyLocationCreate.userErrors;

        // Phone invalid → drop and retry
        if (hasFieldErr(errs, 'phone')) {
          console.warn(`    ⚠️ Phone invalid for "${site.name}" — retrying without phone`);
          dropAddrField(siteLocInput, 'phone');
          siteLocResult = await retryLocation();
          errs = siteLocResult.data?.companyLocationCreate?.userErrors;
        }

        // Zip invalid → drop and retry
        if (hasFieldErr(errs, 'zip')) {
          console.warn(`    ⚠️ Zip invalid for "${site.name}" — retrying without zip`);
          dropAddrField(siteLocInput, 'zip');
          siteLocResult = await retryLocation();
          errs = siteLocResult.data?.companyLocationCreate?.userErrors;
        }

        // Zone code invalid → drop and retry
        if (hasFieldErr(errs, 'zone') || hasFieldErr(errs, 'zonecode')) {
          console.warn(`    ⚠️ Zone code invalid for "${site.name}" — retrying without zoneCode`);
          dropAddrField(siteLocInput, 'zoneCode');
          siteLocResult = await retryLocation();
          errs = siteLocResult.data?.companyLocationCreate?.userErrors;
        }

        // address1 invalid → drop entire address block and retry
        if (hasFieldErr(errs, 'address1')) {
          console.warn(`    ⚠️ Address1 invalid for "${site.name}" — retrying without address`);
          delete siteLocInput.billingAddress;
          delete siteLocInput.shippingAddress;
          siteLocResult = await retryLocation();
          errs = siteLocResult.data?.companyLocationCreate?.userErrors;
        }
      }

      if (!siteLocResult.success) {
        const errMsg = (siteLocResult.errors || []).map(e => e.message || JSON.stringify(e)).join('; ');
        console.warn(`    ⚠️ Failed to create "${site.name}":`, errMsg);
        locationErrors.push({ locationName: site.name, error: errMsg });
        continue;
      }

      const siteLocErrors = siteLocResult.data.companyLocationCreate.userErrors;
      if (siteLocErrors && siteLocErrors.length > 0) {
        const errMsg = siteLocErrors.map(e => e.message || JSON.stringify(e)).join('; ');
        console.warn(`    ⚠️ Errors for "${site.name}":`, errMsg);
        locationErrors.push({ locationName: site.name, error: errMsg });
        continue;
      }

      const createdSiteLoc = siteLocResult.data.companyLocationCreate.companyLocation;
      console.log(`    ✅ Created: "${createdSiteLoc.name}" (${createdSiteLoc.id})`);
      locationsCreated.push(createdSiteLoc.name);

      await applyBuyerConfigToLocation(createdSiteLoc.id, createdSiteLoc.name);

      // Set externalId on the location to the Salesforce Site Id
      if (site.salesforceId) {
        const extIdMutation = `
          mutation companyLocationUpdate($companyLocationId: ID!, $input: CompanyLocationUpdateInput!) {
            companyLocationUpdate(companyLocationId: $companyLocationId, input: $input) {
              companyLocation { id externalId }
              userErrors { field message }
            }
          }
        `;
        const extIdResult = await shopifyGraphQL(extIdMutation, {
          companyLocationId: createdSiteLoc.id,
          input: { externalId: site.salesforceId },
        });
        if (extIdResult.success && !extIdResult.data?.companyLocationUpdate?.userErrors?.length) {
          console.log(`    🔗 externalId set to "${site.salesforceId}"`);
        } else {
          console.warn(`    ⚠️ Failed to set externalId on "${createdSiteLoc.name}"`);
        }
      }

      // Set metafields on the location
      const toStr = v => (v != null ? String(v) : null);
      const toBoolStr = v => (v != null ? String(Boolean(v)) : null);
      const locationMetafieldPairs = [
        { key: 'salesforce_site_id', value: toStr(site.salesforceId), type: 'single_line_text_field' },
        { key: 'created_by_id', value: toStr(site.createdById), type: 'single_line_text_field' },
        { key: 'created_date', value: toStr(site.createdDate), type: 'single_line_text_field' },
        { key: 'last_modified_by_id', value: toStr(site.lastModifiedById), type: 'single_line_text_field' },
        { key: 'last_modified_date', value: toStr(site.lastModifiedDate), type: 'single_line_text_field' },
        { key: 'oracle_cloud_account_number', value: toStr(site.oracleCloudAccountNumber), type: 'single_line_text_field' },
        { key: 'location_address_unique', value: toStr(site.locationAddressUnique), type: 'single_line_text_field' },
        { key: 'location_name_unique', value: toStr(site.locationNameUnique), type: 'single_line_text_field' },
        { key: 'informatica_validation_date', value: toStr(site.informaticaValidationDate), type: 'single_line_text_field' },
        { key: 'is_address_validated', value: toBoolStr(site.isAddressValidated), type: 'boolean' },
        { key: 'latitude', value: toStr(site.latitude), type: 'single_line_text_field' },
        { key: 'longitude', value: toStr(site.longitude), type: 'single_line_text_field' },
        { key: 'site_number', value: toStr(site.siteNumber), type: 'single_line_text_field' },
        { key: 'dunning', value: toBoolStr(site.dunning), type: 'boolean' },
        { key: 'statement', value: toBoolStr(site.statement), type: 'boolean' },
        { key: 'accounting_region_code', value: toStr(site.accountingRegionCode), type: 'single_line_text_field' },
        { key: 'dunning_use_id', value: toStr(site.dunningUseId), type: 'single_line_text_field' },
        { key: 'interface_to_oracle', value: toStr(site.interfaceToOracle), type: 'single_line_text_field' },
        { key: 'oracle_cloud_bill_to_site_id', value: toStr(site.oracleCloudBillToSiteId), type: 'single_line_text_field' },
        { key: 'oracle_cloud_cust_acct_site_id', value: toStr(site.oracleCloudCustAcctSiteId), type: 'single_line_text_field' },
        { key: 'oracle_cloud_location_id', value: toStr(site.oracleCloudLocationId), type: 'single_line_text_field' },
        { key: 'oracle_cloud_party_site_id', value: toStr(site.oracleCloudPartySiteId), type: 'single_line_text_field' },
        { key: 'oracle_cloud_site_use_id', value: toStr(site.oracleCloudSiteUseId), type: 'single_line_text_field' },
        { key: 'oracle_cust_account_id', value: toStr(site.oracleCustAccountId), type: 'single_line_text_field' },
        { key: 'statement_use_id', value: toStr(site.statementUseId), type: 'single_line_text_field' },
        { key: 'status', value: toStr(site.status), type: 'single_line_text_field' },
        { key: 'location_type', value: toStr(site.locationType), type: 'single_line_text_field' },
        { key: 'tax_registration_number', value: toStr(site.taxRegistrationNumber), type: 'single_line_text_field' },
        { key: 'vat_registration_country', value: toStr(site.vatRegistrationCountry), type: 'single_line_text_field' },
        { key: 'operating_unit', value: toStr(site.operatingUnit), type: 'single_line_text_field' },
        { key: 'bill_to_flag', value: toBoolStr(site.isBillTo), type: 'boolean' },
        { key: 'ship_to_flag', value: toBoolStr(site.isShipTo), type: 'boolean' },
        { key: 'account_id', value: toStr(site.accountId), type: 'single_line_text_field' },
      ];

      const locationMetafields = locationMetafieldPairs
        .filter(m => m.value !== null && m.value !== '')
        .map(m => ({
          ownerId: createdSiteLoc.id,
          namespace: 'salesforce',
          key: m.key,
          value: m.value,
          type: m.type,
        }));

      if (locationMetafields.length > 0) {
        const metafieldsMutation = `
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key value }
              userErrors { field message }
            }
          }
        `;
        // Batch in groups of 25 (Shopify limit)
        for (let mi = 0; mi < locationMetafields.length; mi += 25) {
          const batch = locationMetafields.slice(mi, mi + 25);
          const mfResult = await shopifyGraphQL(metafieldsMutation, { metafields: batch });
          if (!mfResult.success || mfResult.data?.metafieldsSet?.userErrors?.length > 0) {
            console.warn(`    ⚠️ Metafield errors for "${createdSiteLoc.name}":`,
              mfResult.data?.metafieldsSet?.userErrors || mfResult.errors);
          } else {
            console.log(`    📋 Set ${batch.length} metafield(s) on "${createdSiteLoc.name}"`);
          }
        }
      }

      // Assign all existing company contacts to this new location
      if (adminRoleId && allCompanyContactIds.length > 0) {
        console.log(`    👥 Assigning ${allCompanyContactIds.length} contact(s) to "${createdSiteLoc.name}"...`);

        let siteCurrentLocationId = createdSiteLoc.id;
        let siteRoleCount = 0;
        let siteGroupNumber = 1;
        let totalAssigned = 0;

        for (const contactId of allCompanyContactIds) {
          if (siteRoleCount >= MAX_CONTACTS_PER_LOCATION) {
            siteGroupNumber++;
            const groupName = `${site.name} - Group ${siteGroupNumber}`;
            const overflowResult = await shopifyGraphQL(createSiteLocationMutation, {
              companyId: company.id,
              input: { ...siteLocInput, name: groupName },
            });
            if (overflowResult.success && !overflowResult.data.companyLocationCreate.userErrors?.length) {
              siteCurrentLocationId = overflowResult.data.companyLocationCreate.companyLocation.id;
              siteRoleCount = 0;
              await applyBuyerConfigToLocation(siteCurrentLocationId, groupName);
            } else {
              console.warn(`    ⚠️ Failed to create overflow "${groupName}"`);
              break;
            }
          }

          const siteRoleId = contactId === mainCompanyContactId ? adminRoleId : (orderingOnlyRoleId || adminRoleId);

          const roleResult = await shopifyGraphQL(roleMutation, {
            companyContactId: contactId,
            companyContactRoleId: siteRoleId,
            companyLocationId: siteCurrentLocationId,
          });

          if (roleResult.success && !roleResult.data?.companyContactAssignRole?.userErrors?.length) {
            siteRoleCount++;
            totalAssigned++;
          }
        }

        console.log(`    ✅ Assigned ${totalAssigned}/${allCompanyContactIds.length} contact(s) across ${siteGroupNumber} location(s)`);
      }
    }

    console.log(`  📊 Locations — created: ${locationsCreated.length} | skipped: ${locationsSkipped.length} | errors: ${locationErrors.length}`);

    return {
      success: true,
      salesforceId,
      shopifyCompanyId: company.id,
      name,
      locationsCreated,
      locationsSkipped,
      locationErrors,
    };
  } catch (error) {
    console.error(`❌ Error syncing locations for "${name}":`, error.message);
    return { success: false, salesforceId, name, error: error.message };
  }
};

/**
 * Batch sync site locations for multiple already-created Shopify companies.
 * @param {array} accounts - Transformed account data array
 * @param {number} delayBetween - ms between each company
 * @returns {object} - { successful, failed }
 */
export const syncSiteLocationsForCompaniesBatch = async (accounts, delayBetween = 500) => {
  const results = { successful: [], failed: [] };

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log(`\n[${i + 1}/${accounts.length}] Syncing locations: ${account.name} (${account.salesforceId})`);

    const result = await syncSiteLocationsForCompany(account);

    if (result.success) {
      results.successful.push(result);
    } else {
      results.failed.push(result);
    }

    if (i < accounts.length - 1 && delayBetween > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetween));
    }
  }

  console.log(`\n📊 Location sync batch complete: ✅ ${results.successful.length} | ❌ ${results.failed.length}`);

  return results;
};

/**
 * Gets location IDs for a specific company
 * @param {string} companyId - Shopify Company GID
 * @returns {Array} - Array of { id, name } objects
 */
export const getCompanyLocationIds = async (companyId) => {
  try {
    const query = `
      query getCompanyLocations($id: ID!) {
        company(id: $id) {
          locations(first: 50) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { id: companyId });

    if (!result.success || !result.data?.company) {
      console.error(`Failed to get locations for company ${companyId}`);
      return [];
    }

    return result.data.company.locations.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
    }));
  } catch (error) {
    console.error(`Get company locations error for ${companyId}:`, error.message);
    return [];
  }
};

/**
 * Assigns company locations to a catalog (merges with existing)
 * @param {string} catalogId - Shopify Catalog GID
 * @param {string[]} companyLocationIds - Array of CompanyLocation GIDs to add
 * @returns {object} - { success, catalog, errors }
 */
export const assignCompanyLocationsToCatalog = async (catalogId, companyLocationIds) => {
  try {
    if (!companyLocationIds || companyLocationIds.length === 0) {
      return { success: false, errors: ['No company location IDs provided'] };
    }

    // First fetch existing company locations on this catalog to merge
    const detailQuery = `
      query getCatalogLocations($id: ID!) {
        catalog(id: $id) {
          id
          title
          ... on CompanyLocationCatalog {
            companyLocations(first: 250) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    `;

    const detailResult = await shopifyGraphQL(detailQuery, { id: catalogId });

    let existingLocationIds = [];
    if (detailResult.success && detailResult.data?.catalog?.companyLocations) {
      existingLocationIds = detailResult.data.catalog.companyLocations.edges.map(e => e.node.id);
    }

    // Merge: add new location IDs without duplicating existing ones
    const mergedLocationIds = [...new Set([...existingLocationIds, ...companyLocationIds])];

    console.log(`   Catalog ${catalogId}: ${existingLocationIds.length} existing + ${companyLocationIds.length} new → ${mergedLocationIds.length} total locations`);

    const mutation = `
      mutation catalogUpdate($id: ID!, $input: CatalogUpdateInput!) {
        catalogUpdate(id: $id, input: $input) {
          catalog {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, {
      id: catalogId,
      input: {
        context: {
          companyLocationIds: mergedLocationIds,
        },
      },
    });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    const { catalogUpdate } = result.data;

    if (catalogUpdate.userErrors?.length > 0) {
      console.error(`Catalog update user errors:`, catalogUpdate.userErrors);
      return { success: false, errors: catalogUpdate.userErrors.map(e => e.message) };
    }

    return {
      success: true,
      catalog: catalogUpdate.catalog,
      existingCount: existingLocationIds.length,
      newCount: companyLocationIds.length,
      totalCount: mergedLocationIds.length,
    };
  } catch (error) {
    console.error(`Assign company locations to catalog error:`, error.message);
    return { success: false, errors: [error.message] };
  }
};

/**
 * Deletes a Shopify company by its GID.
 * Automatically removes all attached contacts first (Shopify requires this).
 * @param {string} companyId - Shopify Company GID (e.g. "gid://shopify/Company/123")
 * @returns {object} - { success, deletedId, errors }
 */
export const deleteShopifyCompany = async (companyId) => {
  try {
    // Step 1: Fetch all company contacts
    const contactsQuery = `
      query getCompanyContacts($id: ID!) {
        company(id: $id) {
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

    const contactsResult = await shopifyGraphQL(contactsQuery, { id: companyId });

    if (!contactsResult.success) {
      return { success: false, errors: contactsResult.errors };
    }

    const contactEdges = contactsResult.data?.company?.contacts?.edges || [];
    const contactIds = contactEdges.map(e => e.node.id);

    // Step 2: Remove all contacts from the company
    if (contactIds.length > 0) {
      console.log(`  👥 Removing ${contactIds.length} contact(s) from company before deletion...`);

      const removeContactsMutation = `
        mutation companyContactsDelete($contactIds: [ID!]!) {
          companyContactsDelete(companyContactIds: $contactIds) {
            deletedCompanyContactIds
            userErrors {
              field
              message
            }
          }
        }
      `;

      const removeResult = await shopifyGraphQL(removeContactsMutation, { contactIds });

      if (!removeResult.success) {
        return { success: false, errors: removeResult.errors };
      }

      const deletedIds = new Set(removeResult.data?.companyContactsDelete?.deletedCompanyContactIds || []);
      const remainingIds = contactIds.filter(id => !deletedIds.has(id));
      console.log(`  ✅ Bulk removed ${deletedIds.size} contact(s)`);

      // Step 2b: For contacts that couldn't be bulk-deleted (e.g. have orders),
      // revoke all their role assignments then retry individual delete
      if (remainingIds.length > 0) {
        console.log(`  ⚠️ ${remainingIds.length} contact(s) not removed — revoking roles and retrying...`);

        const roleAssignmentsQuery = `
          query getContactRoles($id: ID!) {
            companyContact(id: $id) {
              id
              roleAssignments(first: 50) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `;

        const revokeRoleMutation = `
          mutation companyContactRevokeRole($roleAssignmentId: ID!) {
            companyContactRevokeRole(companyContactRoleAssignmentId: $roleAssignmentId) {
              revokedCompanyContactRoleAssignmentId
              userErrors {
                field
                message
              }
            }
          }
        `;

        const deleteOneContactMutation = `
          mutation companyContactDelete($contactId: ID!) {
            companyContactDelete(companyContactId: $contactId) {
              deletedCompanyContactId
              userErrors {
                field
                message
              }
            }
          }
        `;

        for (const contactId of remainingIds) {
          // Revoke all role assignments
          const rolesResult = await shopifyGraphQL(roleAssignmentsQuery, { id: contactId });
          const roleEdges = rolesResult.data?.companyContact?.roleAssignments?.edges || [];

          for (const roleEdge of roleEdges) {
            await shopifyGraphQL(revokeRoleMutation, { roleAssignmentId: roleEdge.node.id });
          }

          if (roleEdges.length > 0) {
            console.log(`    🔓 Revoked ${roleEdges.length} role(s) for contact ${contactId}`);
          }

          // Retry individual delete
          const deleteResult = await shopifyGraphQL(deleteOneContactMutation, { contactId });
          const deleteErrors = deleteResult.data?.companyContactDelete?.userErrors || [];
          if (!deleteResult.success || deleteErrors.length > 0) {
            console.warn(`    ⚠️ Still could not remove contact ${contactId}:`, deleteResult.errors || deleteErrors);
          } else {
            console.log(`    ✅ Removed contact ${contactId} after role revocation`);
          }
        }
      }
    }

    // Step 3: Delete the company (Shopify cascades location deletion)
    const deleteMutation = `
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

    const result = await shopifyGraphQL(deleteMutation, { id: companyId });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    const { deletedCompanyId, userErrors } = result.data.companyDelete;

    if (userErrors && userErrors.length > 0) {
      return { success: false, errors: userErrors.map(e => e.message) };
    }

    return { success: true, deletedId: deletedCompanyId };
  } catch (error) {
    console.error(`deleteShopifyCompany error:`, error.message);
    return { success: false, errors: [error.message] };
  }
};

/**
 * Deletes Shopify customers in bulk.
 * Paginates through all customers (optionally filtered by tag or Salesforce account ID), then deletes each one.
 *
 * @param {object} options
 * @param {string}  [options.tag]           - Only delete customers that have this tag (e.g. "sf_contact_")
 * @param {string}  [options.accountId]     - Only delete customers whose salesforce.salesforce_account_id metafield matches this value
 * @param {boolean} [options.dryRun=false]  - If true, fetch and list customers but do not delete
 * @param {number}  [options.delayBetween=100] - Delay in ms between each delete call
 * @returns {object} result summary
 */
export const deleteAllShopifyCustomers = async ({ tag = null, accountId = null, dryRun = false, delayBetween = 100 } = {}) => {
  try {
    const customerQuery = `
      query getCustomers($first: Int!, $after: String, $query: String) {
        customers(first: $first, after: $after, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
              tags
              ${accountId ? `sfMetafields: metafields(first: 15, namespace: "salesforce") {
                edges {
                  node {
                    key
                    value
                  }
                }
              }` : ''}
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const deleteMutation = `
      mutation customerDelete($id: ID!) {
        customerDelete(input: { id: $id }) {
          deletedCustomerId
          userErrors {
            field
            message
          }
        }
      }
    `;

    const filterDesc = [
      tag ? `tag: "${tag}"` : null,
      accountId ? `accountId: "${accountId}"` : null,
    ].filter(Boolean).join(', ') || 'all customers';
    console.log(`\n🗑️  Starting customer deletion (${filterDesc})${dryRun ? ' [DRY RUN]' : ''}...`);

    // ── Step 1: Paginate and collect all matching customers ──
    const allCustomers = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const variables = {
        first: 250,
        after: cursor || undefined,
        query: tag ? `tag:${tag}` : undefined,
      };

      const result = await shopifyGraphQL(customerQuery, variables);

      if (!result.success) {
        console.error('  ❌ Failed to fetch customers page:', result.errors);
        break;
      }

      const edges = result.data.customers.edges;
      allCustomers.push(...edges.map(e => e.node));
      hasNextPage = result.data.customers.pageInfo.hasNextPage;
      cursor = result.data.customers.pageInfo.endCursor;
      console.log(`  📥 Fetched ${allCustomers.length} customer(s) so far...`);
    }

    // ── Step 1b: Filter by accountId metafield if provided ──
    let filteredCustomers = allCustomers;
    if (accountId) {
      filteredCustomers = allCustomers.filter(c => {
        const metafieldValue = (c.sfMetafields?.edges || [])
          .find(e => e.node.key === 'salesforce_account_id')?.node?.value;
        return metafieldValue === accountId;
      });
      console.log(`  🔍 Filtered to ${filteredCustomers.length} customer(s) with salesforce_account_id = "${accountId}"`);
    }

    console.log(`  📊 Total customers to process: ${filteredCustomers.length}${dryRun ? ' — dry run, skipping deletions' : ''}`);

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        totalFound: filteredCustomers.length,
        customers: filteredCustomers.map(c => ({
          id: c.id,
          email: c.email || '',
          name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
          tags: c.tags || [],
        })),
      };
    }

    // ── Step 2: Delete each customer ──
    const deleted = [];
    const failed = [];

    for (let i = 0; i < filteredCustomers.length; i++) {
      const customer = filteredCustomers[i];
      const label = customer.email || customer.id;
      console.log(`  [${i + 1}/${filteredCustomers.length}] Deleting: ${label}`);

      const result = await shopifyGraphQL(deleteMutation, { id: customer.id });
      const userErrors = result.data?.customerDelete?.userErrors || [];

      if (!result.success || userErrors.length > 0) {
        const errors = result.errors || userErrors.map(e => e.message);
        console.warn(`    ⚠️ Failed: ${JSON.stringify(errors)}`);
        failed.push({ id: customer.id, email: customer.email || '', name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(), errors });
      } else {
        deleted.push({ id: customer.id, email: customer.email || '', name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() });
      }

      if (i < filteredCustomers.length - 1 && delayBetween > 0) {
        await new Promise(r => setTimeout(r, delayBetween));
      }
    }

    console.log(`\n✅ Deletion complete — deleted: ${deleted.length} | failed: ${failed.length}`);

    return {
      success: true,
      dryRun: false,
      totalFound: filteredCustomers.length,
      deletedCount: deleted.length,
      failedCount: failed.length,
      deleted,
      failed,
    };

  } catch (error) {
    console.error('deleteAllShopifyCustomers error:', error.message);
    return { success: false, error: error.message };
  }
};

// ==================== CUSTOMER METAFIELD UPDATE (custom namespace) ====================

/**
 * Fetches all Shopify customers (paginated) including their salesforce + custom namespace metafields.
 * Returns an array of customer objects with metafields resolved to a plain map.
 */
export const fetchAllShopifyCustomersWithSalesforceMetafields = async () => {
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
                node {
                  key
                  value
                }
              }
            }
            customMetafields: metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
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
  let page = 0;

  while (hasNextPage) {
    page++;
    const variables = { first: 250, after: cursor || undefined };
    console.log(`  📥 Fetching customers page ${page}${cursor ? ` (cursor: ...${cursor.slice(-8)})` : ''}...`);
    const result = await shopifyGraphQL(query, variables);

    if (!result.success) {
      const errMsg = JSON.stringify(result.errors || result);
      console.error(`  ❌ Failed to fetch customers page ${page}:`, errMsg);
      throw new Error(`fetchAllShopifyCustomersWithSalesforceMetafields failed on page ${page}: ${errMsg}`);
    }

    for (const edge of result.data.customers.edges) {
      const node = edge.node;

      const sfMeta = {};
      for (const mfEdge of node.sfMetafields.edges) {
        sfMeta[mfEdge.node.key] = mfEdge.node.value;
      }

      const customMeta = {};
      for (const mfEdge of node.customMetafields.edges) {
        customMeta[mfEdge.node.key] = mfEdge.node.value;
      }

      allCustomers.push({
        id: node.id,
        email: node.email,
        firstName: node.firstName,
        lastName: node.lastName,
        tags: node.tags || [],
        salesforceContactId: sfMeta['salesforce_contact_id'] || null,
        salesforceAccountId: sfMeta['salesforce_account_id'] || null,
        existing: {
          salutation: customMeta['salutation'] || null,
          region: customMeta['region'] || null,
          speciality: customMeta['speciality'] || null,
          installedProductModel: customMeta['installed_product_model'] || null,
        },
      });
    }

    hasNextPage = result.data.customers.pageInfo.hasNextPage;
    cursor = result.data.customers.pageInfo.endCursor;
    console.log(`  📥 Page ${page}: ${allCustomers.length} customer(s) fetched so far${hasNextPage ? '' : ' (last page)'}`);
  }

  return allCustomers;
};

/**
 * Updates custom namespace metafields (salutation, region, speciality) on a Shopify customer.
 * Only sets metafields whose values are non-empty.
 *
 * @param {string} customerId - Shopify customer GID (e.g. "gid://shopify/Customer/123")
 * @param {object} values - { salutation, region, speciality }
 */
export const updateCustomerCustomMetafields = async (customerId, { salutation, region, speciality }) => {
  const metafields = [];

  if (salutation) {
    metafields.push({ ownerId: customerId, namespace: 'custom', key: 'salutation', value: salutation, type: 'single_line_text_field' });
  }
  if (region) {
    metafields.push({ ownerId: customerId, namespace: 'custom', key: 'region', value: region, type: 'single_line_text_field' });
  }
  if (speciality) {
    metafields.push({ ownerId: customerId, namespace: 'custom', key: 'speciality', value: speciality, type: 'single_line_text_field' });
  }

  if (metafields.length === 0) {
    return { success: true, skipped: true, reason: 'No values to set' };
  }

  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(mutation, { metafields });
  const userErrors = result.data?.metafieldsSet?.userErrors || [];

  if (!result.success || userErrors.length > 0) {
    return { success: false, errors: result.errors || userErrors };
  }

  return { success: true };
};

/**
 * Fetches all Shopify customers whose salesforce.salesforce_account_id metafield matches the given SF account ID.
 * Uses customerSegmentMembers query (avoids fetching all customers).
 * Returns array of { id, email, displayName }.
 */
export const fetchCustomersByAccountId = async (salesforceAccountId) => {
  const query = `
    query customersByAccountId($query: String!, $first: Int!, $after: String) {
      customerSegmentMembers(first: $first, after: $after, query: $query) {
        edges {
          node {
            id
            displayName
            defaultEmailAddress { emailAddress }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const customers = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await shopifyGraphQL(query, {
      query: `metafields.salesforce.salesforce_account_id = '${salesforceAccountId}'`,
      first: 250,
      after: cursor,
    });

    if (!result.success) {
      console.warn(`  ⚠️ fetchCustomersByAccountId failed for ${salesforceAccountId}:`, result.errors);
      break;
    }

    for (const edge of result.data.customerSegmentMembers.edges) {
      customers.push({
        id: edge.node.id,
        email: edge.node.defaultEmailAddress?.emailAddress || '',
        displayName: edge.node.displayName || '',
      });
    }

    hasNextPage = result.data.customerSegmentMembers.pageInfo.hasNextPage;
    cursor = result.data.customerSegmentMembers.pageInfo.endCursor;
  }

  return customers;
};

/**
 * Updates salesforce.chain_customer_cryogen_discount and salesforce.chain_customer_consumables_discount
 * metafields on a Shopify customer.
 */
export const updateCustomerChainDiscountMetafields = async (customerId, { cryogenDiscount, consumablesDiscount }) => {
  const metafields = [];

  if (cryogenDiscount != null) {
    metafields.push({
      ownerId: customerId,
      namespace: 'salesforce',
      key: 'chain_customer_cryogen_discount',
      value: String(cryogenDiscount),
      type: 'single_line_text_field',
    });
  }
  if (consumablesDiscount != null) {
    metafields.push({
      ownerId: customerId,
      namespace: 'salesforce',
      key: 'chain_customer_consumables_discount',
      value: String(consumablesDiscount),
      type: 'single_line_text_field',
    });
  }

  if (metafields.length === 0) {
    return { success: true, skipped: true, reason: 'No discount values to set' };
  }

  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(mutation, { metafields });
  const userErrors = result.data?.metafieldsSet?.userErrors || [];

  if (!result.success || userErrors.length > 0) {
    return { success: false, errors: result.errors || userErrors };
  }

  return { success: true };
};

/**
 * Fetches ALL products from Shopify with their SKUs (paginated).
 * Returns a flat array of { id, title, handle, status, sku, variantId }.
 */
export const fetchAllShopifyProductsWithSkus = async () => {
  const query = `
    query fetchAllProducts($cursor: String) {
      products(first: 250, after: $cursor) {
        nodes {
          id
          title
          handle
          status
          variants(first: 1) {
            nodes {
              id
              sku
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

  const allProducts = [];
  let cursor = null;
  let page = 0;

  do {
    page++;
    const result = await shopifyGraphQL(query, cursor ? { cursor } : {});
    if (!result.success) {
      console.error('fetchAllShopifyProductsWithSkus error:', result.errors);
      break;
    }

    const nodes = result.data?.products?.nodes || [];
    for (const node of nodes) {
      const variant = node.variants?.nodes?.[0];
      allProducts.push({
        id: node.id,
        title: node.title,
        handle: node.handle,
        status: node.status,
        sku: variant?.sku || '',
        variantId: variant?.id || '',
      });
    }

    const pageInfo = result.data?.products?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
    console.log(`  Page ${page}: fetched ${nodes.length} products (Total: ${allProducts.length})`);
  } while (cursor);

  return allProducts;
};

/**
 * Updates the salesforce.shop_description metafield on a Shopify product.
 *
 * @param {string} productId  - Shopify product GID
 * @param {string} value      - The shop description text
 * @returns {{ success: boolean, errors?: Array }}
 */
export const updateProductShopDescriptionMetafield = async (productId, value) => {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message }
      }
    }
  `;

  const result = await shopifyGraphQL(mutation, {
    metafields: [{
      ownerId: productId,
      namespace: 'salesforce',
      key: 'shop_description',
      value: String(value),
      type: 'single_line_text_field',
    }],
  });

  const userErrors = result.data?.metafieldsSet?.userErrors || [];
  if (!result.success || userErrors.length > 0) {
    return { success: false, errors: result.errors || userErrors };
  }
  return { success: true };
};

/**
 * Fetches all Shopify products with their current descriptionHtml and
 * salesforce.salesforce_product_id metafield value (paginated).
 * Returns array of { id, title, descriptionHtml, salesforceProductId }
 */
export const fetchAllShopifyProductsForDescriptionSync = async () => {
  const query = `
    query fetchProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            descriptionHtml
            sfProductId: metafield(namespace: "salesforce", key: "salesforce_product_id") {
              value
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

  const allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await shopifyGraphQL(query, { first: 250, after: cursor || undefined });

    if (!result.success) {
      console.error('  ❌ fetchAllShopifyProductsForDescriptionSync error:', result.errors);
      break;
    }

    for (const edge of result.data.products.edges) {
      const node = edge.node;
      allProducts.push({
        id: node.id,
        title: node.title,
        descriptionHtml: node.descriptionHtml || '',
        salesforceProductId: node.sfProductId?.value || null,
      });
    }

    hasNextPage = result.data.products.pageInfo.hasNextPage;
    cursor = result.data.products.pageInfo.endCursor;
    console.log(`  📥 Fetched ${allProducts.length} product(s) so far...`);
  }

  return allProducts;
};

/**
 * Fetches all Shopify products with their current tags and salesforce.model metafield,
 * then adds the model value as a tag on any product that doesn't already have it.
 *
 * @param {object} options
 * @param {boolean} [options.dryRun=false] - Log what would change without writing
 * @returns {object} result summary
 */
export const syncModelMetafieldToTags = async ({ dryRun = false } = {}) => {
  const fetchQuery = `
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            tags
            metafield(namespace: "salesforce", key: "model") {
              value
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

  const updateMutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // ── Step 1: Fetch all products ──
  const allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await shopifyGraphQL(fetchQuery, { first: 250, after: cursor || undefined });

    if (!result.success) {
      console.error('  ❌ Failed to fetch products page:', result.errors);
      break;
    }

    for (const edge of result.data.products.edges) {
      allProducts.push(edge.node);
    }

    hasNextPage = result.data.products.pageInfo.hasNextPage;
    cursor = result.data.products.pageInfo.endCursor;
    console.log(`  📥 Fetched ${allProducts.length} product(s) so far...`);
  }

  console.log(`  📊 Total products fetched: ${allProducts.length}`);

  // ── Step 2: Filter products that need the model tag added ──
  const toUpdate = [];
  const skipped = [];

  for (const product of allProducts) {
    const modelValue = product.metafield?.value?.trim();

    if (!modelValue) {
      skipped.push({ id: product.id, title: product.title, reason: 'No salesforce.model metafield' });
      continue;
    }

    if (product.tags.includes(modelValue)) {
      skipped.push({ id: product.id, title: product.title, reason: 'Tag already present' });
      continue;
    }

    toUpdate.push({ id: product.id, title: product.title, existingTags: product.tags, modelValue });
  }

  console.log(`  🔄 Need update: ${toUpdate.length} | Skipped: ${skipped.length}`);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      totalFetched: allProducts.length,
      toUpdate: toUpdate.length,
      skipped: skipped.length,
      products: toUpdate.map(p => ({ id: p.id, title: p.title, modelValue: p.modelValue })),
    };
  }

  // ── Step 3: Update tags ──
  const updated = [];
  const failed = [];

  for (let i = 0; i < toUpdate.length; i++) {
    const { id, title, existingTags, modelValue } = toUpdate[i];
    console.log(`  [${i + 1}/${toUpdate.length}] Adding tag "${modelValue}" to: ${title}`);

    const newTags = [...existingTags, modelValue];
    const result = await shopifyGraphQL(updateMutation, { input: { id, tags: newTags } });
    const userErrors = result.data?.productUpdate?.userErrors || [];

    if (!result.success || userErrors.length > 0) {
      const errors = result.errors || userErrors.map(e => e.message);
      console.warn(`    ❌ Failed: ${JSON.stringify(errors)}`);
      failed.push({ id, title, errors });
    } else {
      console.log(`    ✅ Done`);
      updated.push({ id, title, modelValue });
    }
  }

  return {
    success: true,
    dryRun: false,
    totalFetched: allProducts.length,
    updated: updated.length,
    skipped: skipped.length,
    failed: failed.length,
    updatedProducts: updated,
    failedProducts: failed,
  };
};

/**
 * Gets a Shopify collection ID by its exact title.
 * @param {string} title - The exact collection title to search for
 * @returns {string|null} - The Shopify collection GID or null if not found
 */
export const getShopifyCollectionIdByTitle = async (title) => {
  const query = `
    query getCollectionByTitle($query: String!) {
      collections(first: 10, query: $query) {
        nodes { id title }
      }
    }
  `;
  const result = await shopifyGraphQL(query, { query: `title:'${title}'` });
  const match = (result.data?.collections?.nodes || []).find(c => c.title === title);
  return match?.id || null;
};

/**
 * Finds Shopify customer IDs for a list of Salesforce contact IDs
 * by searching tags in the format "sf_contact_{contactId}".
 * Batches the tag query to avoid excessively long query strings.
 *
 * @param {string[]} contactIds - Array of Salesforce contact IDs
 * @returns {string[]} - Array of unique Shopify customer GIDs
 */
export const findShopifyCustomersByContactIds = async (contactIds) => {
  if (!contactIds || contactIds.length === 0) return [];

  const BATCH_SIZE = 20;
  const customerIds = new Set();

  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const batch = contactIds.slice(i, i + BATCH_SIZE);
    const tagQuery = batch.map(id => `tag:sf_contact_${id}`).join(' OR ');

    let hasNextPage = true;
    let endCursor = null;

    while (hasNextPage) {
      const gqlQuery = `
        query findCustomersByTags($query: String!${endCursor ? ', $cursor: String!' : ''}) {
          customers(first: 250, query: $query${endCursor ? ', after: $cursor' : ''}) {
            nodes { id tags }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
      const variables = { query: tagQuery };
      if (endCursor) variables.cursor = endCursor;

      const result = await shopifyGraphQL(gqlQuery, variables);
      const nodes = result.data?.customers?.nodes || [];
      nodes.forEach(c => customerIds.add(c.id));
      hasNextPage = result.data?.customers?.pageInfo?.hasNextPage || false;
      endCursor = result.data?.customers?.pageInfo?.endCursor || null;
    }
  }

  return [...customerIds];
};

/**
 * Fetches all existing automatic discounts from Shopify.
 * Returns a map of lowercased title → discount node ID for duplicate checking.
 *
 * @returns {Object} - { [lowercasedTitle]: discountNodeId }
 */
export const getExistingAutomaticDiscounts = async () => {
  const query = `
    query {
      automaticDiscountNodes(first: 250) {
        nodes {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic {
              title
              context {
                ... on DiscountCustomerSegments {
                  segments { id }
                }
              }
            }
          }
        }
      }
    }
  `;
  const result = await shopifyGraphQL(query, {});
  const nodes = result.data?.automaticDiscountNodes?.nodes || [];
  const map = {};
  for (const node of nodes) {
    const discount = node.automaticDiscount;
    const title = discount?.title;
    if (!title) continue;
    const segmentIds = (discount?.context?.segments || []).map(s => s.id);
    map[title.toLowerCase()] = { nodeId: node.id, segmentCount: segmentIds.length, segmentIds };
  }
  return map;
};

/**
 * Adds customers to an existing automatic discount in Shopify.
 * Uses discountAutomaticBasicUpdate with customerSelection.customers.add.
 *
 * @param {string}   discountNodeId - The Shopify DiscountAutomaticNode GID
 * @param {string[]} customerIds    - Array of Shopify customer GIDs to add
 * @returns {{ success: boolean, discountId?: string, errors?: Array }}
 */
export const addCustomersToAutomaticDiscount = async (discountNodeId, customerIds) => {
  if (!customerIds || customerIds.length === 0) {
    return { success: true, discountId: discountNodeId, customersAdded: 0 };
  }

  const BATCH_SIZE = 10;
  const mutation = `
    mutation discountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
      discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic {
              title
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  let totalAdded = 0;
  for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
    const batch = customerIds.slice(i, i + BATCH_SIZE);
    const res = await shopifyGraphQL(mutation, {
      id: discountNodeId,
      automaticBasicDiscount: {
        context: { customers: { add: batch } },
      },
    });

    if (!res.success) {
      return { success: false, errors: res.errors, customersAdded: totalAdded };
    }
    const result = res.data?.discountAutomaticBasicUpdate;
    if (!result) {
      return { success: false, errors: [{ message: 'No response from Shopify' }], customersAdded: totalAdded };
    }
    if (result.userErrors?.length > 0) {
      return { success: false, errors: result.userErrors, customersAdded: totalAdded };
    }
    totalAdded += batch.length;
  }

  return { success: true, discountId: discountNodeId, customersAdded: totalAdded };
};

/**
 * Creates an automatic percentage discount scoped to a specific collection
 * and restricted to a list of Shopify customers.
 *
 * @param {object}   params
 * @param {string}   params.title        - Discount title (e.g. "Cryogen 20%")
 * @param {number}   params.percentage   - Percentage value as a number (e.g. 20 for 20%)
 * @param {string}   params.collectionId - Shopify collection GID
 * @param {string[]} params.customerIds  - Shopify customer GIDs to restrict eligibility
 * @returns {{ success: boolean, discountId?: string, title?: string, errors?: Array }}
 */
export const createAutomaticCollectionDiscount = async ({ title, percentage, collectionId, customerIds = [] }) => {
  const BATCH_SIZE = 10;
  const mutation = `
    mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
      discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic {
              title
              startsAt
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  // Create with the first batch of customers (Shopify limits customers.add per call)
  const firstBatch = customerIds.slice(0, BATCH_SIZE);
  const variables = {
    automaticBasicDiscount: {
      title,
      startsAt: new Date().toISOString(),
      combinesWith: {
        productDiscounts: true,
        orderDiscounts: true,
        shippingDiscounts: true,
      },
      context: firstBatch.length > 0
        ? { customers: { add: firstBatch } }
        : { all: 'ALL' },
      customerGets: {
        value: { percentage: percentage / 100 },
        items: {
          collections: { add: [collectionId] },
        },
      },
    },
  };

  const res = await shopifyGraphQL(mutation, variables);
  if (!res.success) {
    return { success: false, errors: res.errors };
  }
  const result = res.data?.discountAutomaticBasicCreate;
  if (!result) {
    return { success: false, errors: [{ message: 'No response from Shopify' }] };
  }
  if (result.userErrors?.length > 0) {
    return { success: false, errors: result.userErrors };
  }

  const discountId = result.automaticDiscountNode?.id;

  // Add remaining customers in batches via update
  if (customerIds.length > BATCH_SIZE && discountId) {
    const remaining = customerIds.slice(BATCH_SIZE);
    const addResult = await addCustomersToAutomaticDiscount(discountId, remaining);
    if (!addResult.success) {
      // Discount was created but some customers failed — return partial success
      return {
        success: true,
        partial: true,
        discountId,
        title: result.automaticDiscountNode?.automaticDiscount?.title,
        customerErrors: addResult.errors,
      };
    }
  }

  return {
    success: true,
    discountId,
    title: result.automaticDiscountNode?.automaticDiscount?.title,
  };
};

// Shopify hard limit: max 5 customer segment prerequisites per automatic discount
const MAX_SEGMENTS_PER_DISCOUNT = 5;

/**
 * Adds segments to an existing automatic discount (max MAX_SEGMENTS_PER_DISCOUNT total).
 *
 * @param {string}   discountNodeId  - The Shopify DiscountAutomaticNode GID
 * @param {string[]} segmentIds      - Array of Shopify Segment GIDs to add
 * @param {number}   currentCount    - How many segments the discount already has
 * @returns {{ success, discountId, segmentsAdded, overflow: string[] }}
 */
export const addSegmentsToAutomaticDiscount = async (discountNodeId, segmentIds, currentCount = 0) => {
  if (!segmentIds || segmentIds.length === 0) {
    return { success: true, discountId: discountNodeId, segmentsAdded: 0, overflow: [] };
  }

  const available = Math.max(0, MAX_SEGMENTS_PER_DISCOUNT - currentCount);
  const toAdd = segmentIds.slice(0, available);
  const overflow = segmentIds.slice(available);

  if (toAdd.length === 0) {
    return { success: true, discountId: discountNodeId, segmentsAdded: 0, overflow };
  }

  const mutation = `
    mutation discountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
      discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic { title }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const res = await shopifyGraphQL(mutation, {
    id: discountNodeId,
    automaticBasicDiscount: {
      context: { customerSegments: { add: toAdd } },
    },
  });

  if (!res.success) return { success: false, errors: res.errors, overflow };
  const result = res.data?.discountAutomaticBasicUpdate;
  if (!result) return { success: false, errors: [{ message: 'No response from Shopify' }], overflow };
  if (result.userErrors?.length > 0) return { success: false, errors: result.userErrors, overflow };

  return { success: true, discountId: discountNodeId, segmentsAdded: toAdd.length, overflow };
};

/**
 * Creates an automatic percentage discount scoped to a collection,
 * restricted to a list of Shopify customer segments.
 *
 * @param {object}   params
 * @param {string}   params.title        - Discount title (e.g. "Cryogen 20%")
 * @param {number}   params.percentage   - Percentage as a number (e.g. 20 for 20%)
 * @param {string}   params.collectionId - Shopify collection GID
 * @param {string[]} params.segmentIds   - Shopify Segment GIDs to restrict eligibility
 */
export const createAutomaticCollectionDiscountWithSegments = async ({ title, percentage, collectionId, segmentIds = [] }) => {
  const mutation = `
    mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
      discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic { title startsAt }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    automaticBasicDiscount: {
      title,
      startsAt: new Date().toISOString(),
      combinesWith: {
        productDiscounts: true,
        orderDiscounts: true,
        shippingDiscounts: true,
      },
      context: segmentIds.length > 0
        ? { customerSegments: { add: segmentIds.slice(0, MAX_SEGMENTS_PER_DISCOUNT) } }
        : { all: 'ALL' },
      customerGets: {
        value: { percentage: percentage / 100 },
        items: {
          collections: { add: [collectionId] },
        },
      },
    },
  };

  const res = await shopifyGraphQL(mutation, variables);
  if (!res.success) return { success: false, errors: res.errors };
  const result = res.data?.discountAutomaticBasicCreate;
  if (!result) return { success: false, errors: [{ message: 'No response from Shopify' }] };
  if (result.userErrors?.length > 0) return { success: false, errors: result.userErrors };

  return {
    success: true,
    discountId: result.automaticDiscountNode?.id,
    title: result.automaticDiscountNode?.automaticDiscount?.title,
  };
};

// ==================== DUPLICATE LOCATION FINDER ====================

const fetchAllLocationsForCompany = async (companyId) => {
  const locations = [];
  let cursor = null;
  let hasNextPage = true;

  const query = `
    query getCompanyLocations($id: ID!, $after: String) {
      company(id: $id) {
        locations(first: 250, after: $after) {
          edges {
            node { id name externalId createdAt }
            cursor
          }
          pageInfo { hasNextPage }
        }
      }
    }
  `;

  while (hasNextPage) {
    const result = await shopifyGraphQL(query, { id: companyId, after: cursor });
    if (!result.success) break;
    const edges = result.data.company?.locations?.edges || [];
    hasNextPage = result.data.company?.locations?.pageInfo?.hasNextPage || false;
    for (const edge of edges) locations.push(edge.node);
    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    if (!cursor) break;
  }

  return locations;
};

export const findDuplicateCompanyLocations = async ({ filterDate } = {}) => {
  const filterDatePrefix = filterDate ? filterDate.slice(0, 10) : null;
  const allCompanies = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 1;

  const companiesQuery = `
    query getCompanies($after: String) {
      companies(first: 250, after: $after) {
        edges {
          node {
            id
            name
            externalId
            locations(first: 250) {
              edges { node { id name externalId createdAt } cursor }
              pageInfo { hasNextPage }
            }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  console.log('📥 Fetching all companies with locations...');

  while (hasNextPage) {
    const result = await shopifyGraphQL(companiesQuery, { after: cursor });
    if (!result.success) throw new Error(`Failed to fetch companies: ${JSON.stringify(result.errors)}`);

    const edges = result.data.companies.edges;
    hasNextPage = result.data.companies.pageInfo.hasNextPage;

    for (const edge of edges) {
      const company = edge.node;
      let locations = company.locations.edges.map(e => e.node);

      // Paginate locations if company has more than 250
      if (company.locations.pageInfo.hasNextPage) {
        const extra = await fetchAllLocationsForCompany(company.id);
        // extra starts from page 1 — merge without the first 250 already fetched
        const existingIds = new Set(locations.map(l => l.id));
        for (const loc of extra) {
          if (!existingIds.has(loc.id)) locations.push(loc);
        }
      }

      allCompanies.push({ id: company.id, name: company.name, externalId: company.externalId, locations });
    }

    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    page++;
    if (!hasNextPage || !cursor) break;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`✅ Scanned ${allCompanies.length} companies`);

  const duplicates = [];

  for (const company of allCompanies) {
    const nameGroups = {};
    for (const loc of company.locations) {
      const key = loc.name.toLowerCase().trim();
      if (!nameGroups[key]) nameGroups[key] = [];
      nameGroups[key].push(loc);
    }

    const duplicateGroups = [];
    for (const [normalizedName, locs] of Object.entries(nameGroups)) {
      if (locs.length <= 1) continue;

      // If every location has a different non-null externalId → different SF sites with same name → not duplicates
      const externalIds = locs.map(l => l.externalId).filter(Boolean);
      const allDifferentNonNull = externalIds.length === locs.length && new Set(externalIds).size === locs.length;
      if (allDifferentNonNull) continue;

      // Annotate each location with whether it matches the date filter
      const annotatedLocs = locs.map(l => ({
        ...l,
        createdAtDate: l.createdAt ? l.createdAt.slice(0, 10) : null,
        matchesDateFilter: filterDatePrefix ? (l.createdAt ? l.createdAt.startsWith(filterDatePrefix) : false) : null,
      }));

      // If date filter is active, only include groups where at least one location matches
      if (filterDatePrefix && !annotatedLocs.some(l => l.matchesDateFilter)) continue;

      duplicateGroups.push({ normalizedName, count: locs.length, locations: annotatedLocs });
    }

    if (duplicateGroups.length > 0) {
      duplicates.push({
        companyId: company.id,
        companyName: company.name,
        companySalesforceId: company.externalId || '',
        totalLocations: company.locations.length,
        duplicateGroups,
      });
    }
  }

  const totalDuplicateGroups = duplicates.reduce((s, c) => s + c.duplicateGroups.length, 0);
  const totalDuplicateLocations = duplicates.reduce(
    (s, c) => s + c.duplicateGroups.reduce((ss, g) => ss + g.count, 0), 0
  );

  return {
    totalCompanies: allCompanies.length,
    companiesWithDuplicates: duplicates.length,
    totalDuplicateGroups,
    totalDuplicateLocations,
    companies: duplicates,
  };
};

export const deleteCompanyLocation = async (locationId) => {
  const result = await shopifyGraphQL(`
    mutation companyLocationDelete($companyLocationId: ID!) {
      companyLocationDelete(companyLocationId: $companyLocationId) {
        deletedCompanyLocationId
        userErrors { field message }
      }
    }
  `, { companyLocationId: locationId });

  if (!result.success) return { success: false, error: JSON.stringify(result.errors) };

  const userErrors = result.data?.companyLocationDelete?.userErrors || [];
  if (userErrors.length > 0) return { success: false, error: userErrors.map(e => e.message).join(', ') };

  return { success: true, deletedLocationId: result.data.companyLocationDelete.deletedCompanyLocationId };
};

export const checkContactsInShopify = async (contactIds) => {
  if (!contactIds || contactIds.length === 0) return new Set();

  const BATCH_SIZE = 20;
  const foundContactIds = new Set();

  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const batch = contactIds.slice(i, i + BATCH_SIZE);
    const tagQuery = batch.map(id => `tag:sf_contact_${id}`).join(' OR ');

    let hasNextPage = true;
    let endCursor = null;

    while (hasNextPage) {
      const gqlQuery = `
        query findCustomersByTags($query: String!${endCursor ? ', $cursor: String!' : ''}) {
          customers(first: 250, query: $query${endCursor ? ', after: $cursor' : ''}) {
            nodes { tags }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
      const variables = { query: tagQuery };
      if (endCursor) variables.cursor = endCursor;

      const result = await shopifyGraphQL(gqlQuery, variables);
      if (!result.success) {
        console.error(`  ❌ checkContactsInShopify batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, result.errors);
        break;
      }

      for (const node of result.data?.customers?.nodes || []) {
        for (const tag of node.tags || []) {
          const match = tag.match(/^sf_contact_(.+)$/);
          if (match) foundContactIds.add(match[1]);
        }
      }

      hasNextPage = result.data?.customers?.pageInfo?.hasNextPage || false;
      endCursor = result.data?.customers?.pageInfo?.endCursor || null;
    }
  }

  return foundContactIds;
};

export const fetchAllShopifyCustomersForAddressSync = async () => {
  const query = `
    query getCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        edges {
          node {
            id
            email
            firstName
            lastName
            numberOfOrders
            addresses {
              id
            }
            sfMetafields: metafields(first: 10, namespace: "salesforce") {
              edges { node { key value } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const allCustomers = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage) {
    page++;
    const variables = { first: 250, after: cursor || undefined };
    console.log(`  📥 Fetching customers page ${page}...`);
    const result = await shopifyGraphQL(query, variables);

    if (!result.success) {
      const errMsg = JSON.stringify(result.errors || result);
      console.error(`  ❌ Failed to fetch customers page ${page}:`, errMsg);
      throw new Error(`fetchAllShopifyCustomersForAddressSync failed on page ${page}: ${errMsg}`);
    }

    for (const edge of result.data.customers.edges) {
      const node = edge.node;
      const sfMeta = {};
      for (const mfEdge of node.sfMetafields.edges) sfMeta[mfEdge.node.key] = mfEdge.node.value;
      allCustomers.push({
        id: node.id,
        email: node.email,
        firstName: node.firstName,
        lastName: node.lastName,
        numberOfOrders: parseInt(node.numberOfOrders || 0, 10),
        addressIds: (node.addresses || []).map(a => a.id),
        salesforceContactId: sfMeta['salesforce_contact_id'] || null,
        salesforceAccountId: sfMeta['salesforce_account_id'] || null,
      });
    }

    hasNextPage = result.data.customers.pageInfo.hasNextPage;
    cursor = result.data.customers.pageInfo.endCursor;
    console.log(`  📥 Page ${page}: ${allCustomers.length} customer(s) fetched so far${hasNextPage ? '' : ' (last page)'}`);
  }

  return allCustomers;
};

export const createCustomerAddress = async (customerId, address) => {
  const result = await shopifyGraphQL(`
    mutation customerAddressCreate($customerId: ID!, $address: MailingAddressInput!) {
      customerAddressCreate(customerId: $customerId, address: $address) {
        customerAddress { id }
        userErrors { field message }
      }
    }
  `, { customerId, address });
  const userErrors = result.data?.customerAddressCreate?.userErrors || [];
  if (!result.success || userErrors.length > 0) {
    return { success: false, error: userErrors[0]?.message || JSON.stringify(result.errors) };
  }
  return { success: true, addressId: result.data.customerAddressCreate.customerAddress.id };
};

export const setCustomerDefaultAddress = async (customerId, addressId) => {
  const result = await shopifyGraphQL(`
    mutation customerDefaultAddressUpdate($customerId: ID!, $addressId: ID!) {
      customerDefaultAddressUpdate(customerId: $customerId, addressId: $addressId) {
        customer { id }
        userErrors { field message }
      }
    }
  `, { customerId, addressId });
  const userErrors = result.data?.customerDefaultAddressUpdate?.userErrors || [];
  if (!result.success || userErrors.length > 0) {
    return { success: false, error: userErrors[0]?.message || JSON.stringify(result.errors) };
  }
  return { success: true };
};

export const deleteCustomerAddress = async (customerId, addressId) => {
  const result = await shopifyGraphQL(`
    mutation customerAddressDelete($customerId: ID!, $addressId: ID!) {
      customerAddressDelete(customerId: $customerId, addressId: $addressId) {
        deletedCustomerAddressId
        userErrors { field message }
      }
    }
  `, { customerId, addressId });
  const userErrors = result.data?.customerAddressDelete?.userErrors || [];
  if (!result.success || userErrors.length > 0) {
    return { success: false, error: userErrors[0]?.message || JSON.stringify(result.errors) };
  }
  return { success: true };
};

