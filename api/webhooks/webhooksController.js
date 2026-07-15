import jwt from 'jsonwebtoken';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../../common/logger';
import { evaluateProductWebhook } from '../../common/scanEngine';
import { fetchProduct } from '../../common/shopifyGraphqlService';

export const authenticateWebhook = (req, res, next) => {
  res.sendStatus(200);
  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET_KEY)
      .update(req.body, 'utf8', 'hex')
      .digest('base64');

    if (hash === hmac) {
      req.body = JSON.parse(req.body.toString());
      next();
    } else {
      logger.info('Danger! Not from Shopify!', {
        shopName: req.get('X-Shopify-Shop-Domain'),
      });
    }
  } catch (error) {
    logger.error(`Error in authenticating webhook ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      header: JSON.stringify(req.headers),
      stack: error.stack,
    });
  }
};

export const shopUpdate = async (req, res, next) => {
  try {
    jwt.sign(
      { shopName: req.get('X-Shopify-Shop-Domain') },
      process.env.JWT_SECRET,
      { expiresIn: '600000ms' },
      async (jwtErr, token) => {
        if (jwtErr) {
          logger.error(
            `Error in generating JWT token for shop update webhook ${jwtErr.message}`,
            {
              shopName: req.get('X-Shopify-Shop-Domain'),
              payload: req.body,
              stack: jwtErr.stack,
            },
          );
          return;
        }
        const jwtHeader = {
          headers: {
            authorization: 'Bearer ' + token,
          },
        };
        const shop = await axios
          .get(`${process.env.HOST}/shops`, jwtHeader)
          .catch(shopErr => {
            logger.error(
              `Error in fetching shop details in shop update webhook ${shopErr.message}`,
              {
                shopName: req.get('X-Shopify-Shop-Domain'),
                payload: req.body,
                stack: shopErr.stack,
              },
            );
            return;
          });
        if (shop) {
          if (
            new Date(shop.data.updated_at).getTime() !==
            new Date(req.body.updated_at).getTime()
          ) {
            await axios
              .put(`${process.env.HOST}/shops`, req.body, jwtHeader)
              .catch(shopUpdateErr => {
                logger.error(
                  `Error in updating shop data in shop update webhook ${shopUpdateErr.message}`,
                  {
                    shopName: req.get('X-Shopify-Shop-Domain'),
                    payload: req.body,
                    stack: shopUpdateErr.stack,
                  },
                );
                return;
              });
          }
        }
      },
    );
  } catch (error) {
    logger.error(`Global error in shop update webhook ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      payload: req.body,
      stack: error.stack,
    });
    return;
  }
};

export const appUninstalled = async (req, res, next) => {
  try {
    jwt.sign(
      { shopName: req.get('X-Shopify-Shop-Domain') },
      process.env.JWT_SECRET,
      { expiresIn: '600000ms' },
      async (jwtErr, token) => {
        if (jwtErr) {
          logger.error(
            `Error in generating JWT token for app uninstall webhook ${jwtErr.message}`,
            {
              shopName: req.get('X-Shopify-Shop-Domain'),
              payload: req.body,
              stack: jwtErr.stack,
            },
          );
          return;
        }
        const jwtHeader = {
          headers: {
            authorization: 'Bearer ' + token,
          },
        };

        const shopSecretData = {
          chargeStatus: 'uninstalled',
        };

        await Promise.all([
          axios.delete(`${process.env.HOST}/shops`, jwtHeader),
          axios.delete(`${process.env.HOST}/settings`, jwtHeader),
          axios.put(
            `${process.env.HOST}/shop-secrets`,
            shopSecretData,
            jwtHeader,
          ),
        ]).catch(promiseErr => {
          logger.error(
            `Error in deleting shop data and updating charge status in app uninstall webhook ${promiseErr.message}`,
            {
              shopName: req.get('X-Shopify-Shop-Domain'),
              payload: req.body,
              stack: promiseErr.stack,
            },
          );
          return;
        });
      },
    );
  } catch (error) {
    logger.error(`Global error in app uninstall webhook ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      payload: req.body,
      stack: error.stack,
    });
    return;
  }
};

// ── Product webhooks ─────────────────────────────────────────────────────────

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
    const productId = String(req.body.id);
    const Violations = (await import('../violations/violationsModel')).default;
    await Violations.updateMany(
      { shopName, product_id: productId, status: 'active' },
      { status: 'resolved', resolved_at: new Date() },
    );
  } catch (error) {
    logger.error(`Product delete webhook error for ${shopName}: ${error.message}`, { stack: error.stack });
  }
};

export const inventoryLevelUpdated = async (req, res, next) => {
  logger.info(`Inventory level updated for shop: ${req.get('X-Shopify-Shop-Domain')}`);
};
