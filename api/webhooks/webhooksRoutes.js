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

// GDPR mandatory webhooks — individual topic routes
router.post('/customers/data_request', authenticateWebhook, customersDataRequest);
router.post('/customers/redact', authenticateWebhook, customersRedact);
router.post('/shop/redact', authenticateWebhook, shopRedact);

// Unified compliance endpoint — single URL for Partner Dashboard / shopify.app.toml config
// Shopify sends all compliance topics here; X-Shopify-Topic header routes to the right handler
router.post('/compliance', authenticateWebhook, (req, res, next) => {
  const topic = req.get('X-Shopify-Topic');
  if (topic === 'customers/data_request') return customersDataRequest(req, res, next);
  if (topic === 'customers/redact') return customersRedact(req, res, next);
  if (topic === 'shop/redact') return shopRedact(req, res, next);
});

export default router;
