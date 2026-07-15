import jwt from 'jsonwebtoken';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../../common/logger';
import { evaluateProductWebhook } from '../../common/scanEngine';
import { fetchProduct } from '../../common/shopifyGraphqlService';

// ── Webhook authentication ────────────────────────────────────────────────────

export const authenticateWebhook = (req, res, next) => {
  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET_KEY)
      .update(req.body, 'utf8', 'hex')
      .digest('base64');

    if (hash === hmac) {
      // Respond 200 immediately (Shopify requires a fast ack), then process async
      res.sendStatus(200);
      req.body = JSON.parse(req.body.toString());
      next();
    } else {
      logger.info('Webhook HMAC validation failed — not from Shopify', {
        shopName: req.get('X-Shopify-Shop-Domain'),
      });
      res.sendStatus(401);
    }
  } catch (error) {
    logger.error(`Error authenticating webhook: ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      stack: error.stack,
    });
    res.sendStatus(500);
  }
};

// ── Shop / app webhooks ───────────────────────────────────────────────────────

export const shopUpdate = async (req, res, next) => {
  try {
    jwt.sign(
      { shopName: req.get('X-Shopify-Shop-Domain') },
      process.env.JWT_SECRET,
      { expiresIn: '600000ms' },
      async (jwtErr, token) => {
        if (jwtErr) {
          logger.error(`JWT error in shop/update webhook: ${jwtErr.message}`, { stack: jwtErr.stack });
          return;
        }
        const jwtHeader = { headers: { authorization: 'Bearer ' + token } };
        const shop = await axios.get(`${process.env.HOST}/shops`, jwtHeader).catch(shopErr => {
          logger.error(`Error fetching shop in shop/update webhook: ${shopErr.message}`, { stack: shopErr.stack });
          return null;
        });
        if (shop && new Date(shop.data.updated_at).getTime() !== new Date(req.body.updated_at).getTime()) {
          await axios.put(`${process.env.HOST}/shops`, req.body, jwtHeader).catch(err => {
            logger.error(`Error updating shop in shop/update webhook: ${err.message}`, { stack: err.stack });
          });
        }
      },
    );
  } catch (error) {
    logger.error(`Global error in shop/update webhook: ${error.message}`, { stack: error.stack });
  }
};

export const appUninstalled = async (req, res, next) => {
  const shopName = req.get('X-Shopify-Shop-Domain');
  logger.info(`App uninstalled for shop: ${shopName} — deleting all data`);
  try {
    const [Rules, Violations, ScanLog, Settings, Shop, ShopSecret] = await Promise.all([
      import('../rules/rulesModel').then(m => m.default),
      import('../violations/violationsModel').then(m => m.default),
      import('../scan/scanLogModel').then(m => m.default),
      import('../settings/settingsModel').then(m => m.default),
      import('../shops/shopsModel').then(m => m.default),
      import('../shopSecrets/shopSecretsModel').then(m => m.default),
    ]);

    await Promise.all([
      Rules.deleteMany({ shopName }),
      Violations.deleteMany({ shopName }),
      ScanLog.deleteMany({ shopName }),
      Settings.deleteMany({ shopName }),
      Shop.deleteMany({ shopName }),
      ShopSecret.findOneAndUpdate({ shopName }, { chargeStatus: 'uninstalled' }),
    ]);

    logger.info(`All data deleted for uninstalled shop: ${shopName}`);
  } catch (error) {
    logger.error(`Error deleting data for uninstalled shop ${shopName}: ${error.message}`, { stack: error.stack });
  }
};

// ── Product webhooks ──────────────────────────────────────────────────────────

async function handleProductChange(req) {
  const shopName = req.get('X-Shopify-Shop-Domain');
  try {
    const productId = String(req.body.id);
    const gid = `gid://shopify/Product/${productId}`;
    const product = await fetchProduct(shopName, gid);
    if (product) {
      await evaluateProductWebhook(shopName, product);
    }
  } catch (error) {
    logger.error(`Product webhook error for ${shopName}: ${error.message}`, { stack: error.stack });
  }
}

export const productCreated = async (req, res, next) => {
  await handleProductChange(req);
};

export const productUpdated = async (req, res, next) => {
  await handleProductChange(req);
};

export const productDeleted = async (req, res, next) => {
  const shopName = req.get('X-Shopify-Shop-Domain');
  try {
    const Violations = (await import('../violations/violationsModel')).default;
    await Violations.updateMany(
      { shopName, product_id: String(req.body.id), status: 'active' },
      { status: 'resolved', resolved_at: new Date() },
    );
  } catch (error) {
    logger.error(`Product delete webhook error for ${shopName}: ${error.message}`, { stack: error.stack });
  }
};

export const inventoryLevelUpdated = async (req, res, next) => {
  logger.info(`Inventory level updated for shop: ${req.get('X-Shopify-Shop-Domain')}`);
};

// ── GDPR Mandatory Webhooks ───────────────────────────────────────────────────
// Required by Shopify for all apps in the App Store.

export const customersDataRequest = (req, res, next) => {
  // AlertFlow stores product violation data only — no personal customer PII.
  // Log the request and acknowledge; nothing to export.
  logger.info('GDPR customers/data_request received', {
    shopName: req.get('X-Shopify-Shop-Domain'),
    payload: req.body,
  });
};

export const customersRedact = (req, res, next) => {
  // AlertFlow stores no personal customer data — acknowledge the redaction request.
  logger.info('GDPR customers/redact received', {
    shopName: req.get('X-Shopify-Shop-Domain'),
    payload: req.body,
  });
};

export const shopRedact = async (req, res, next) => {
  // Shopify sends this 48 hours after a shop uninstalls.
  // Delete all shop data: rules, violations, scan logs, settings.
  const shopName = req.get('X-Shopify-Shop-Domain');
  logger.info(`GDPR shop/redact received for ${shopName}`);
  try {
    const [Rules, Violations, ScanLog, Settings] = await Promise.all([
      import('../rules/rulesModel').then(m => m.default),
      import('../violations/violationsModel').then(m => m.default),
      import('../scan/scanLogModel').then(m => m.default),
      import('../settings/settingsModel').then(m => m.default),
    ]);
    await Promise.all([
      Rules.deleteMany({ shopName }),
      Violations.deleteMany({ shopName }),
      ScanLog.deleteMany({ shopName }),
      Settings.deleteMany({ shopName }),
    ]);
    logger.info(`GDPR shop/redact: deleted all AlertFlow data for ${shopName}`);
  } catch (error) {
    logger.error(`GDPR shop/redact error for ${shopName}: ${error.message}`, { stack: error.stack });
  }
};
