import axios from 'axios';
import jwt from 'jsonwebtoken';
import Plans from '../globalPlans/globalPlansModel';
import Constants from '../../common/constants';
import logger from '../../common/logger';

export const get = async (req, res, next) => {
  try {
    const discounts = await axios
      .get(`${process.env.LOCAL_HOST}/discounts?shop=${req.shopName}`)
      .catch(discountErr => {
        throw discountErr;
      });

    Plans.aggregate([{ $sort: { originalPrice: 1 } }])
      .then(plans => {
        for (let plan of plans) {
          if (plan.id !== 'free') {
            const discountApplied = discounts.data.find(
              i => i.planId === plan.id,
            );
            if (discountApplied) {
              plan.price =
                discountApplied && discountApplied.price
                  ? discountApplied.price
                  : plan.price;
              plan.trialDays =
                discountApplied && discountApplied.trialDays
                  ? discountApplied.trialDays
                  : plan.trialDays;
            }
          }
        }
        res.json(plans);
      })
      .catch(err => {
        next(err);
      });
  } catch (error) {
    next(error);
  }
};

export const post = async (req, res, next) => {
  try {
    if (req.body.planId) {
      const jwtHeaders = {
        headers: {
          authorization: req.headers['authorization'],
        },
      };
      if (req.body.planId === 'free') {
        const shopSecretObj = {
          chargeId: null,
          chargeStatus: 'pending',
          planId: 'free',
        };
        axios
          .put(
            `${process.env.LOCAL_HOST}/shop-secrets`,
            shopSecretObj,
            jwtHeaders,
          )
          .catch(err => {
            throw err;
          });
        res.json({ message: 'Success' });
      } else {
        const [discount, shopSecret, plan] = await axios
          .all([
            axios.get(
              `${process.env.LOCAL_HOST}/discounts/${req.body.planId}?shop=${req.shopName}`,
            ),
            axios.get(`${process.env.LOCAL_HOST}/shop-secrets`, jwtHeaders),
            axios.get(
              `${process.env.LOCAL_HOST}/global-plans/${req.body.planId}`,
              jwtHeaders,
            ),
          ])
          .catch(axiosErr => {
            throw axiosErr;
          });

        if (shopSecret && shopSecret.data && plan && plan.data) {
          const shopifyHeaders = {
            headers: {
              'x-shopify-access-token': shopSecret.data.permanentToken,
            },
          };
          if (discount && discount.data) {
            plan.data.price =
              discount.data && discount.data.price
                ? discount.data.price
                : plan.data.price;
            plan.data.trialDays =
              discount.data && discount.data.trialDays
                ? discount.data.trialDays
                : plan.data.trialDays;
          }
          if (plan.data.type === 'yearly') {
            const body = {
              query: `
            mutation {
              appSubscriptionCreate(
                  name: "${plan.data.name}"
                  returnUrl: "${
                    process.env.HOST +
                    '/plans/activate?shop=' +
                    req.shopName +
                    '&planId=' +
                    plan.data.id
                  }"
                  test: ${process.env.NODE_ENV === 'production' ? false : true}
                  trialDays: ${plan.data.trialDays}
                  lineItems: [
                  {
                      plan: {
                          appRecurringPricingDetails: {
                              price: { amount: "${
                                plan.data.price
                              }", currencyCode: USD }
                              interval: ANNUAL
                          }
                      }
                  }
                  ]
              ) {
                  appSubscription {
                      id
                  }
                  confirmationUrl
                  userErrors {
                      field
                      message
                  }
              }
          }
            `,
            };
            const planRes = await axios
              .post(
                `https://${req.shopName}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`,
                body,
                shopifyHeaders,
              )
              .catch(shopifyErr => {
                logger.error(
                  `Error occured in applying annual plan ${shopifyErr.message}`,
                  {
                    shopName: req.shopName,
                  },
                );
                throw shopifyErr;
              });
            if (
              planRes.data &&
              planRes.data.data &&
              planRes.data.data.appSubscriptionCreate &&
              planRes.data.data.appSubscriptionCreate.userErrors &&
              planRes.data.data.appSubscriptionCreate.userErrors.length <= 0
            ) {
              res.json({
                url: planRes.data.data.appSubscriptionCreate.confirmationUrl,
              });
            } else {
              logger.error(
                `Error occured in applying annual plan ${planRes.data.data.appSubscriptionCreate.userErrors}`,
                {
                  shopName: req.shopName,
                },
              );
            }
          } else if (plan.data.type === 'monthly') {
            const body = {
              query: `
            mutation {
              appSubscriptionCreate(
                  name: "${plan.data.name}"
                  returnUrl: "${
                    process.env.HOST +
                    '/plans/activate?shop=' +
                    req.shopName +
                    '&planId=' +
                    plan.data.id
                  }"
                  test: ${process.env.NODE_ENV === 'production' ? false : true}
                  trialDays: ${plan.data.trialDays}
                  lineItems: [
                  {
                      plan: {
                          appRecurringPricingDetails: {
                              price: { amount: "${
                                plan.data.price
                              }", currencyCode: USD }
                              interval: EVERY_30_DAYS
                          }
                      }
                  }
                  ]
              ) {
                  appSubscription {
                      id
                  }
                  confirmationUrl
                  userErrors {
                      field
                      message
                  }
              }
          }
            `,
            };
            const planRes = await axios
              .post(
                `https://${req.shopName}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`,
                body,
                shopifyHeaders,
              )
              .catch(shopifyErr => {
                logger.error(
                  `Error occured in applying monthly plan ${shopifyErr.message}`,
                  {
                    shopName: req.shopName,
                  },
                );
                throw shopifyErr;
              });
            if (
              planRes.data &&
              planRes.data.data &&
              planRes.data.data.appSubscriptionCreate &&
              planRes.data.data.appSubscriptionCreate.userErrors &&
              planRes.data.data.appSubscriptionCreate.userErrors.length <= 0
            ) {
              res.json({
                url: planRes.data.data.appSubscriptionCreate.confirmationUrl,
              });
            } else {
              logger.error(
                `Error occured in applying annual plan ${planRes.data.data.appSubscriptionCreate.userErrors}`,
                {
                  shopName: req.shopName,
                },
              );
            }
          } else {
            const body = {
              query: `
            mutation {
              appPurchaseOneTimeCreate(
                name: "${plan.data.name}"
                price: { amount: "${plan.data.price}", currencyCode: USD }
                returnUrl: "${
                  process.env.HOST +
                  '/plans/activate?shop=' +
                  req.shopName +
                  '&planId=' +
                  plan.data.id
                }"
                test: ${process.env.NODE_ENV === 'production' ? false : true}
              ) {
                userErrors {
                  field
                  message
                }
                confirmationUrl
                appPurchaseOneTime {
                  id
                }
              }
            }            
            `,
            };
            const planRes = await axios
              .post(
                `https://${req.shopName}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`,
                body,
                shopifyHeaders,
              )
              .catch(shopifyErr => {
                logger.error(
                  `Error occured in applying one time plan ${shopifyErr.message}`,
                  {
                    shopName: req.shopName,
                  },
                );
                throw shopifyErr;
              });
            if (
              planRes.data &&
              planRes.data.data &&
              planRes.data.data.appPurchaseOneTimeCreate &&
              planRes.data.data.appPurchaseOneTimeCreate.userErrors &&
              planRes.data.data.appPurchaseOneTimeCreate.userErrors.length <= 0
            ) {
              res.json({
                url: planRes.data.data.appPurchaseOneTimeCreate.confirmationUrl,
              });
            } else {
              logger.error(
                `Error occured in applying annual plan ${planRes.data.data.appPurchaseOneTimeCreate.userErrors}`,
                {
                  shopName: req.shopName,
                },
              );
            }
          }
        } else {
          res.status(400).send({ message: Constants.PLANS.NO_DATA });
        }
      }
    } else {
      res.status(400).send({ message: Constants.PLANS.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};

export const activate = async (req, res, next) => {
  try {
    const chargeId = req.query.charge_id;
    const shop = req.query.shop;
    const planId = req.query.planId;
    jwt.sign(
      { shopName: shop },
      process.env.JWT_SECRET,
      { expiresIn: '600000ms' },
      async (jwtErr, token) => {
        if (jwtErr) {
          logger.error(
            `Error in generating JWT token for activating plan ${jwtErr.message}`,
            {
              shopName: shop,
              payload: req.query,
              header: JSON.stringify(req.headers),
              stack: jwtErr.stack,
            },
          );
          next(jwtErr);
        } else {
          try {
            const jwtHeader = {
              headers: {
                authorization: 'Bearer ' + token,
              },
            };
            const shopSecretObj = {
              chargeId: chargeId,
              chargeStatus: 'active',
              planId: planId,
            };
            await axios
              .put(
                `${process.env.LOCAL_HOST}/shop-secrets`,
                shopSecretObj,
                jwtHeader,
              )
              .catch(err => {
                throw err;
              });
            res.redirect(301, process.env.REACT_APP_URL);
          } catch (mainErr) {
            next(mainErr);
          }
        }
      },
    );
  } catch (error) {
    next(error);
  }
};

export const deactivate = async (req, res, next) => {
  try {
    const jwtHeaders = {
      headers: {
        authorization: req.headers['authorization'],
      },
    };
    const shopSecret = await axios
      .get(`${process.env.LOCAL_HOST}/shop-secrets`, jwtHeaders)
      .catch(err => {
        throw err;
      });
    const shopifyHeaders = {
      headers: {
        'x-shopify-access-token': shopSecret.data.permanentToken,
      },
    };
    const chargesRes = await axios
      .get(
        `https://${req.shopName}/admin/api/${process.env.SHOPIFY_API_VERSION}/recurring_application_charges.json`,
        shopifyHeaders,
      )
      .catch(err => {
        throw err;
      });
    const activatedPlan = chargesRes.data.recurring_application_charges.find(
      i => i.status === 'active',
    );
    if (activatedPlan) {
      await axios
        .delete(
          `https://${req.shopName}/admin/api/${process.env.SHOPIFY_API_VERSION}/recurring_application_charges/${activatedPlan.id}.json`,
          shopifyHeaders,
        )
        .catch(err => {
          throw err;
        });
      const shopSecretObj = {
        chargeId: null,
        chargeStatus: 'pending',
        planId: 'free',
      };
      await axios
        .get(
          `${process.env.LOCAL_HOST}/shop-secrets`,
          shopSecretObj,
          jwtHeaders,
        )
        .catch(err => {
          throw err;
        });
      res.json({ message: 'Success' });
    } else {
      res.status(400).send({ message: Constants.PLANS.NO_ACTIVATED_PLAN });
    }
  } catch (error) {
    next(error);
  }
};
