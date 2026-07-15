import Discounts from './discountsModel';
import Constants from '../../common/constants';
import axios from 'axios';
import jwt from 'jsonwebtoken';

export const getAll = async (req, res, next) => {
  try {
    if (req.query.shop) {
      const discounts = await Discounts.find({
        shopName: req.query.shop,
      }).catch(err => {
        throw err;
      });
      res.json(discounts);
    } else {
      return res
        .status(400)
        .send({ message: Constants.DISCOUNTS.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};

export const get = async (req, res, next) => {
  try {
    if (req.query.shop && req.params.id) {
      const discount = await Discounts.findOne({
        shopName: req.query.shop,
        planId: req.params.id,
      }).catch(err => {
        throw err;
      });
      res.json(discount);
    } else {
      return res
        .status(400)
        .send({ message: Constants.DISCOUNTS.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};

export const post = async (req, res, next) => {
  try {
    if (req.body.shopName && req.body.planId) {
      jwt.sign(
        { shopName: req.body.shopName },
        process.env.JWT_SECRET,
        { expiresIn: '600000ms' }, // 10 minutes
        async (jwtErr, token) => {
          if (jwtErr) {
            throw jwtErr;
          }
          try {
            const jwtHeader = {
              headers: {
                authorization: 'Bearer ' + token,
              },
            };
            const shopSecret = await axios
              .get(`${process.env.LOCAL_HOST}/shop-secrets`, jwtHeader)
              .catch(shopSecretErr => {
                throw shopSecretErr;
              });
            if (
              !(
                shopSecret &&
                shopSecret.data &&
                shopSecret.data.chargeStatus &&
                shopSecret.data.planId &&
                shopSecret.data.chargeStatus === 'active' &&
                shopSecret.data.planId === req.body.planId
              )
            ) {
              const discount = await Discounts.findOne({
                shopName: req.body.shopName,
                planId: req.body.planId,
              }).catch(discountErr => {
                throw discountErr;
              });
              if (discount) {
                const updated = await Discounts.findOneAndUpdate(
                  { shopName: req.body.shopName, planId: req.body.planId },
                  req.body,
                  { new: true, runValidators: true },
                ).catch(err => {
                  throw err;
                });
                if (updated) {
                  res.json(updated);
                } else {
                  res
                    .status(404)
                    .send({ message: Constants.DISCOUNTS.NO_DATA });
                }
              } else {
                const discountObj = new Discounts(req.body);
                const newDiscount = await discountObj.save().catch(err => {
                  throw err;
                });
                res.json(newDiscount);
              }
            } else {
              return res
                .status(400)
                .send({ message: Constants.DISCOUNTS.PLAN_ACTIVE });
            }
          } catch (mainErr) {
            next(mainErr);
          }
        },
      );
    } else {
      return res
        .status(400)
        .send({ message: Constants.DISCOUNTS.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};

export const deleteData = async (req, res, next) => {
  try {
    if (req.query.shop && req.query.planId) {
      const deleted = await Discounts.findOneAndDelete({
        shopName: req.query.shop,
        planId: req.query.planId,
      }).catch(err => {
        throw err;
      });
      if (deleted) {
        res.json(deleted);
      } else {
        res.status(404).send(Constants.DISCOUNTS.NO_DATA);
      }
    } else {
      return res
        .status(400)
        .send({ message: Constants.DISCOUNTS.PARAMETER_MISSING });
    }
  } catch (error) {
    next(error);
  }
};
