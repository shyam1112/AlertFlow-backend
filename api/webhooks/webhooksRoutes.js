import express from 'express';
import {
  authenticateWebhook,
  shopUpdate,
  appUninstalled,
  productCreated,
  productUpdated,
  productDeleted,
  inventoryLevelUpdated,
  customersDataRequest,
  customersRedact,
  shopRedact,
} from './webhooksController';

const router = express.Router();

// Product / shop webhooks
router.post('/shop/update', authenticateWebhook, shopUpdate);
router.post('/app/uninstalled', authenticateWebhook, appUninstalled);
router.post('/products/create', authenticateWebhook, productCreated);
router.post('/products/update', authenticateWebhook, productUpdated);
router.post('/products/delete', authenticateWebhook, productDeleted);
router.post('/inventory_levels/update', authenticateWebhook, inventoryLevelUpdated);

// GDPR mandatory webhooks (required for Shopify App Store)
router.post('/customers/data_request', authenticateWebhook, customersDataRequest);
router.post('/customers/redact', authenticateWebhook, customersRedact);
router.post('/shop/redact', authenticateWebhook, shopRedact);

export default router;
