import { fetchMetafieldDefinitions } from '../../common/shopifyGraphqlService';
import logger from '../../common/logger';

export const getMetafieldDefinitions = async (req, res, next) => {
  try {
    const { resource = 'product' } = req.query;
    const ownerType = resource === 'variant' ? 'PRODUCTVARIANT' : 'PRODUCT';
    const definitions = await fetchMetafieldDefinitions(req.shopName, ownerType);
    res.json({ definitions });
  } catch (error) {
    logger.error(`metafieldDefinitions error for ${req.shopName}: ${error.message}`, { stack: error.stack });
    // Return empty list with reason instead of 500 — the form can fall back to manual entry
    res.json({ definitions: [], warning: error.message });
  }
};
