import express from 'express';
import {
  authenticateWebhook,
  shopUpdate,
  appUninstalled,
  productCreated,
  productUpdated,
  productDeleted,
  inventoryLevelUpdated,
} from './webhooksController';

const router = express.Router();

router.post('/shop/update', authenticateWebhook, shopUpdate);
router.post('/app/uninstalled', authenticateWebhook, appUninstalled);
router.post('/products/create', authenticateWebhook, productCreated);
router.post('/products/update', authenticateWebhook, productUpdated);
router.post('/products/delete', authenticateWebhook, productDeleted);
router.post('/inventory_levels/update', authenticateWebhook, inventoryLevelUpdated);

export default router;
