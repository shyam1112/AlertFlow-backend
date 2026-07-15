import Shops from './shopsModel';
import Constants from '../../common/constants';

export const get = async (req, res, next) => {
  try {
    const shop = await Shops.findOne({ myshopify_domain: req.shopName }).catch(
      err => {
        throw err;
      },
    );
    res.json(shop);
  } catch (error) {
    next(error);
  }
};

export const post = async (req, res, next) => {
  try {
    const shop = await Shops.findOneAndUpdate(
      { myshopify_domain: req.body.myshopify_domain || req.shopName },
      req.body,
      { new: true, upsert: true, runValidators: false },
    ).catch(err => { throw err; });
    res.json(shop);
  } catch (error) {
    next(error);
  }
};

export const put = async (req, res, next) => {
  try {
    const updated = await Shops.findOneAndUpdate(
      { myshopify_domain: req.shopName },
      req.body,
      { new: true, runValidators: true },
    ).catch(err => {
      throw err;
    });
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).send({ message: Constants.SHOP.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};

export const deleteData = async (req, res, next) => {
  try {
    const removed = await Shops.findOneAndDelete({
      myshopify_domain: req.shopName,
    }).catch(err => {
      throw err;
    });
    if (removed) {
      res.json(removed);
    } else {
      res.status(404).send({ message: Constants.SHOP.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};
