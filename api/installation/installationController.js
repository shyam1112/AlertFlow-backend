import nonce from 'nonce';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import logger from '../../common/logger';
import Constants from '../../common/constants';

// Server-side state store — avoids third-party cookie blocking in Shopify admin iframe.
// Each entry expires after 10 minutes.
const stateStore = new Map();

function pruneExpiredStates() {
  const now = Date.now();
  for (const [key, expiry] of stateStore) {
    if (now > expiry) stateStore.delete(key);
  }
}

export const init = (req, res, next) => {
  try {
    const { shop } = req.query;
    console.log("Sgop : ", shop);
    if (shop) {
      const generatedState = String(nonce()());
      stateStore.set(generatedState, Date.now() + 10 * 60 * 1000);
      pruneExpiredStates();

      const redirectUri = `${process.env.HOST}/init/callback`;
      const installUri =
        'https://' +
        shop +
        '/admin/oauth/authorize?client_id=' +
        process.env.SHOPIFY_API_KEY +
        '&scope=' +
        process.env.SCOPE +
        '&state=' +
        generatedState +
        '&redirect_uri=' +
        redirectUri;
      console.log("installUri : ",installUri);
      // Break out of Shopify's iframe — accounts.shopify.com refuses to load inside an iframe
      res.send(`<!DOCTYPE html><html><head></head><body><script>window.top.location.href = ${JSON.stringify(installUri)};</script></body></html>`);
    } else {
      return res
        .status(400)
        .send({ message: Constants.INSTALLATION.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};

export const initCallback = (req, res, next) => {
  try {
    const { shop, hmac, code, state } = req.query;
    console.log("Code : ", code);

    const expiry = stateStore.get(state);
    if (!expiry || Date.now() > expiry) {
      return res
        .status(403)
        .send({ message: Constants.INSTALLATION.NOT_VERIFIED });
    }
    stateStore.delete(state);

    if (shop && hmac && code) {
      const map = Object.assign({}, req.query);
      delete map['hmac'];
      const message = serialize(map);
      const generatedHash = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET_KEY)
        .update(message)
        .digest('hex');

      if (generatedHash !== hmac) {
        return res.status(403).send({
          message: Constants.INSTALLATION.HMAC_VALIDATION_FAILED,
        });
      }

      jwt.sign(
        { shopName: shop },
        process.env.JWT_SECRET,
        { expiresIn: '24h' },
        async (jwtErr, token) => {
          if (jwtErr) {
            return next(jwtErr);
          } else {
            try {
              const jwtHeaders = {
                headers: {
                  authorization: 'Bearer ' + token,
                },
              };

              const shopDetails = await axios
                .get(`${process.env.LOCAL_HOST}/shops`, jwtHeaders)
                .catch(() => null);
              // Check if shopSecrets also exists — if not, treat as fresh install
              // so the token gets saved even when the shop record already exists
              const shopSecretCheck = await axios
                .get(`${process.env.LOCAL_HOST}/shop-secrets`, jwtHeaders)
                .catch(() => null);
              const hasToken = shopSecretCheck?.data?.permanentToken;

              if (shopDetails && shopDetails.data && hasToken) {
                res.redirect(
                  301,
                  `${process.env.REACT_APP_URL}/?fresh_install=0&token=${token}`,
                );
              } else {
                const accessTokenRequestUri = `https://${shop}/admin/oauth/access_token`;
                const accessTokenPayload = {
                  client_id: process.env.SHOPIFY_API_KEY,
                  client_secret: process.env.SHOPIFY_API_SECRET_KEY,
                  code: code,
                };
                const accessTokenRes = await axios
                  .post(accessTokenRequestUri, accessTokenPayload)
                  .catch(accessTokenErr => {
                    logger.error(
                      `Error in getting shopify access token ${accessTokenErr.response}`,
                      {
                        storeName: shop,
                        payload: accessTokenPayload,
                        header: JSON.stringify(req.headers),
                        stack: accessTokenErr.stack,
                      },
                    );
                    throw accessTokenErr;
                  });

                if (accessTokenRes && accessTokenRes.data) {
                  const accessToken = accessTokenRes.data.access_token;
                  console.log("Access Token : ", accessToken);
                  const shopifyHeaders = {
                    headers: {
                      'x-shopify-access-token': accessToken,
                    },
                  };
                  try {
                    const shopRes = await axios
                      .get(`https://${shop}/admin/shop.json`, shopifyHeaders)
                      .catch(shopifyShopErr => {
                        logger.error(
                          `Error in fetching shop.json form shopify for installation ${shopifyShopErr.message}`,
                          {
                            shopName: shop,
                            header: JSON.stringify(req.headers),
                            stack: shopifyShopErr.stack,
                          },
                        );
                        throw shopifyShopErr;
                      });

                    if (shopRes && shopRes.data) {
                      const shopSecretData = {
                        shopName: shop,
                        permanentToken: accessToken,
                      };
                      const settingsData = {
                        communicationName: shopRes.data.shop.shop_owner || null,
                        communicationEmailId: shopRes.data.shop.email || null,
                        dashboardLanguage:
                          shopRes.data.shop.primary_locale || 'en',
                      };

                      await axios
                        .all([
                          axios.post(
                            `${process.env.HOST}/shops`,
                            shopRes.data.shop,
                            jwtHeaders,
                          ),
                          axios.post(
                            `${process.env.HOST}/shop-secrets`,
                            shopSecretData,
                            jwtHeaders,
                          ),
                          axios.post(
                            `${process.env.HOST}/settings`,
                            settingsData,
                            jwtHeaders,
                          ),
                        ])
                        .catch(postErr => {
                          logger.error(
                            `Error in storing shop, settings and and it's secret for installation ${postErr.message}`,
                            {
                              shopName: shop,
                              header: JSON.stringify(req.headers),
                              stack: postErr.stack,
                              payload: shopSecretData,
                            },
                          );
                          throw postErr;
                        });

                      const webhookTopics = [
                        'app/uninstalled',
                        'shop/update',
                        'products/create',
                        'products/update',
                        'products/delete',
                        'inventory_levels/update',
                        // GDPR mandatory webhooks
                        'customers/data_request',
                        'customers/redact',
                        'shop/redact',
                      ];
                      const webhookUrl = topic =>
                        `${process.env.HOST}/webhooks/${topic}`;

                      // Register webhooks individually — ignore 422 (already exists)
                      await Promise.allSettled(
                        webhookTopics.map(topic =>
                          axios
                            .post(
                              `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION}/webhooks.json`,
                              { webhook: { topic, address: webhookUrl(topic), format: 'json' } },
                              shopifyHeaders,
                            )
                            .catch(err => {
                              const status = err.response && err.response.status;
                              if (status === 422) {
                                logger.info(`Webhook already exists for ${topic} on ${shop}, skipping`);
                              } else {
                                logger.error(`Webhook registration failed for ${topic}: ${err.message}`);
                              }
                            }),
                        ),
                      );

                      res.redirect(
                        301,
                        `${process.env.REACT_APP_URL}/?fresh_install=1&token=${token}`,
                      );
                    }
                  } catch (mainErr) {
                    next(mainErr);
                  }
                }
              }
            } catch (globalrr) {
              next(globalrr);
            }
          }
        },
      );
    } else {
      return res
        .status(400)
        .send({ message: Constants.INSTALLATION.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};

function serialize(obj) {
  let str = [];
  for (const p in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, p)) {
      // obj.hasOwnProperty(p)
      str.push(encodeURIComponent(p) + '=' + encodeURIComponent(obj[p]));
    }
  }
  return str.join('&');
}
