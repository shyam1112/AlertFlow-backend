import Rules from './rulesModel';

export const getAll = async (req, res, next) => {
  try {
    const rules = await Rules.find({ shopName: req.shopName }).sort({ createdAt: -1 });
    res.json({ rules });
  } catch (error) {
    next(error);
  }
};

export const get = async (req, res, next) => {
  try {
    const rule = await Rules.findOne({ _id: req.params.id, shopName: req.shopName });
    if (rule) {
      res.json(rule);
    } else {
      res.status(404).json({ message: 'Rule not found' });
    }
  } catch (error) {
    next(error);
  }
};

export const create = async (req, res, next) => {
  try {
    const rule = new Rules({ ...req.body, shopName: req.shopName });
    const saved = await rule.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const updated = await Rules.findOneAndUpdate(
      { _id: req.params.id, shopName: req.shopName },
      req.body,
      { new: true, runValidators: true },
    );
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).json({ message: 'Rule not found' });
    }
  } catch (error) {
    next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    const deleted = await Rules.findOneAndDelete({ _id: req.params.id, shopName: req.shopName });
    if (deleted) {
      res.json({ message: 'Rule deleted', rule: deleted });
    } else {
      res.status(404).json({ message: 'Rule not found' });
    }
  } catch (error) {
    next(error);
  }
};

export const toggle = async (req, res, next) => {
  try {
    const rule = await Rules.findOne({ _id: req.params.id, shopName: req.shopName });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    rule.is_active = !rule.is_active;
    await rule.save();
    res.json(rule);
  } catch (error) {
    next(error);
  }
};
