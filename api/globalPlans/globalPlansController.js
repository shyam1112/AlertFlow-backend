import Plans from './globalPlansModel';
import Constants from '../../common/constants';

export const getAll = async (req, res, next) => {
  try {
    const plans = await Plans.find({}).catch(err => {
      throw err;
    });
    res.json(plans);
  } catch (error) {
    next(error);
  }
};

export const get = async (req, res, next) => {
  try {
    const plan = await Plans.findOne({ id: req.params.id }).catch(err => {
      throw err;
    });
    if (plan) {
      res.json(plan);
    } else {
      res.status(404).send({ message: Constants.GLOBAL_PLANS.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};

export const post = async (req, res, next) => {
  try {
    const planObj = new Plans(req.body);
    const plan = await planObj.save().catch(err => {
      throw err;
    });
    res.json(plan);
  } catch (error) {
    next(error);
  }
};

export const put = async (req, res, next) => {
  try {
    const updated = await Plans.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true, runValidators: true },
    ).catch(err => {
      throw err;
    });
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).send({ message: Constants.GLOBAL_PLANS.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};

export const deleteData = async (req, res, next) => {
  try {
    const deleted = await Plans.findOneAndDelete({ id: req.params.id }).catch(
      err => {
        throw err;
      },
    );
    if (deleted) {
      res.json(deleted);
    } else {
      res.status(404).send({ message: Constants.GLOBAL_PLANS.NO_DATA });
    }
  } catch (error) {
    next(error);
  }
};
