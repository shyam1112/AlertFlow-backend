import Settings from './settingsModel';
import Constants from '../../common/constants';

export const get = async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ shopName: req.shopName });
    if (settings) {
      res.json(settings);
    } else {
      res.status(404).send({ message: Constants.SETTINGS.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};

export const post = async (req, res, next) => {
  try {
    req.body.shopName = req.shopName;
    // upsert to avoid duplicate key on reinstall
    const setting = await Settings.findOneAndUpdate(
      { shopName: req.shopName },
      req.body,
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json(setting);
  } catch (error) {
    next(error);
  }
};

export const put = async (req, res, next) => {
  try {
    req.body.shopName = req.shopName;
    const updated = await Settings.findOneAndUpdate(
      { shopName: req.shopName },
      req.body,
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json(updated);
  } catch (error) {
    next(error);
  }
};

export const deleteData = async (req, res, next) => {
  try {
    const deleted = await Settings.findOneAndDelete({ shopName: req.shopName });
    if (deleted) {
      res.json(deleted);
    } else {
      res.status(404).send({ message: Constants.SETTINGS.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};
