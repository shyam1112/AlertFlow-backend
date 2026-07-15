import axios from 'axios';
import ShopSecrets from '../api/shopSecrets/shopSecretsModel';
import logger from './logger';

async function getToken(shopName) {
  const secret = await ShopSecrets.findOne({ shopName });
  if (!secret || !secret.permanentToken) {
    throw new Error(`No permanent token found for shop: ${shopName}`);
  }
  return secret.permanentToken;
}

function shopifyGqlUrl(shopName) {
  return `https://${shopName}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;
}

async function gqlRequest(shopName, query, variables = {}) {
  const token = await getToken(shopName);
  const res = await axios.post(
    shopifyGqlUrl(shopName),
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } },
  );
  if (res.data.errors) {
    throw new Error(res.data.errors.map(e => e.message).join(', '));
  }
  return res.data.data;
}

const PRODUCTS_QUERY = `
  query fetchProducts($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          status
          tags
          createdAt
          updatedAt
          images(first: 1) { edges { node { id } } }
          variants(first: 100) {
            edges {
              node {
                id
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
              }
            }
          }
          metafields(first: 50) {
            edges {
              node {
                namespace
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

export async function fetchAllProducts(shopName) {
  const products = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await gqlRequest(shopName, PRODUCTS_QUERY, { cursor });
    const { edges, pageInfo } = data.products;

    for (const { node } of edges) {
      products.push({
        id: node.id.replace('gid://shopify/Product/', ''),
        gid: node.id,
        title: node.title,
        handle: node.handle,
        vendor: node.vendor,
        productType: node.productType,
        status: node.status,
        tags: node.tags,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        images_count: node.images.edges.length,
        variants: node.variants.edges.map(v => ({
          id: v.node.id.replace('gid://shopify/ProductVariant/', ''),
          sku: v.node.sku,
          barcode: v.node.barcode,
          price: v.node.price,
          compareAtPrice: v.node.compareAtPrice,
          inventory_quantity: v.node.inventoryQuantity,
        })),
        metafields: node.metafields.edges.map(m => ({
          namespace: m.node.namespace,
          key: m.node.key,
          value: m.node.value,
        })),
      });
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  logger.info(`Fetched ${products.length} products for ${shopName}`);
  return products;
}

const SINGLE_PRODUCT_QUERY = `
  query fetchProduct($id: ID!) {
    product(id: $id) {
      id title handle vendor productType status tags createdAt updatedAt
      images(first: 1) { edges { node { id } } }
      variants(first: 100) {
        edges { node { id sku barcode price compareAtPrice inventoryQuantity } }
      }
      metafields(first: 50) {
        edges { node { namespace key value } }
      }
    }
  }
`;

const METAFIELD_DEFS_QUERY = `
  query MetafieldDefs($ownerType: MetafieldOwnerType!, $cursor: String) {
    metafieldDefinitions(ownerType: $ownerType, first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node { name namespace key type { name } }
      }
    }
  }
`;

export async function fetchMetafieldDefinitions(shopName, ownerType) {
  const defs = [];
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await gqlRequest(shopName, METAFIELD_DEFS_QUERY, { ownerType, cursor });
    const result = data.metafieldDefinitions;
    if (!result) break;
    defs.push(...result.edges.map(e => e.node));
    hasNextPage = result.pageInfo.hasNextPage;
    cursor = result.pageInfo.endCursor;
  }
  return defs;
}

export async function fetchProduct(shopName, productGid) {
  const data = await gqlRequest(shopName, SINGLE_PRODUCT_QUERY, { id: productGid });
  const node = data.product;
  if (!node) return null;
  return {
    id: node.id.replace('gid://shopify/Product/', ''),
    gid: node.id,
    title: node.title,
    handle: node.handle,
    vendor: node.vendor,
    productType: node.productType,
    status: node.status,
    tags: node.tags,
    images_count: node.images.edges.length,
    variants: node.variants.edges.map(v => ({
      id: v.node.id.replace('gid://shopify/ProductVariant/', ''),
      sku: v.node.sku,
      barcode: v.node.barcode,
      price: v.node.price,
      compareAtPrice: v.node.compareAtPrice,
      inventory_quantity: v.node.inventoryQuantity,
    })),
    metafields: node.metafields.edges.map(m => ({
      namespace: m.node.namespace,
      key: m.node.key,
      value: m.node.value,
    })),
  };
}
