import ShopSecrets from './shopSecretsModel';
import Constants from '../../common/constants';

export const get = async (req, res, next) => {
  try {
    const shopSecret = await ShopSecrets.findOne({
      shopName: req.shopName,
    }).catch(err => {
      throw err;
    });
    if (shopSecret) {
      res.json(shopSecret);
    } else {
      res.status(404).send({ message: Constants.SHOP_SECRET.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};

export const post = async (req, res, next) => {
  try {
    await ShopSecrets.findOneAndDelete({ shopName: req.shopName }).catch(
      removedErr => {
        throw removedErr;
      },
    );
    req.body.shopName = req.shopName;
    const newShopSecrets = new ShopSecrets(req.body);
    const shopSecret = await newShopSecrets.save().catch(err => {
      throw err;
    });
    res.json(shopSecret);
  } catch (error) {
    next(error);
  }
};

export const put = async (req, res, next) => {
  try {
    const updated = await ShopSecrets.findOneAndUpdate(
      { shopName: req.shopName },
      req.body,
      { new: true, runValidators: true },
    ).catch(err => {
      throw err;
    });
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).send({ message: Constants.SHOP_SECRET.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};
