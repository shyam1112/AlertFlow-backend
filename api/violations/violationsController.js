import Violations from './violationsModel';

export const getAll = async (req, res, next) => {
  try {
    const { status, search, resource_type, rule_name, limit = 50, page = 1 } = req.query;
    const filter = { shopName: req.shopName };
    if (status && status !== 'all') filter.status = status;
    if (resource_type && resource_type !== 'all') filter.resource_type = resource_type;
    if (rule_name && rule_name !== 'all') filter.rule_name = rule_name;
    if (search) {
      filter.$or = [
        { product_title: { $regex: search, $options: 'i' } },
        { rule_name: { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [violations, total] = await Promise.all([
      Violations.find(filter).sort({ first_detected_at: -1 }).skip(skip).limit(Number(limit)),
      Violations.countDocuments(filter),
    ]);
    res.json({ violations, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    next(error);
  }
};

export const get = async (req, res, next) => {
  try {
    const violation = await Violations.findOne({ _id: req.params.id, shopName: req.shopName });
    if (violation) {
      res.json(violation);
    } else {
      res.status(404).json({ message: 'Violation not found' });
    }
  } catch (error) {
    next(error);
  }
};

export const create = async (req, res, next) => {
  try {
    const violation = new Violations({ ...req.body, shopName: req.shopName });
    const saved = await violation.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const resolve = async (req, res, next) => {
  try {
    const updated = await Violations.findOneAndUpdate(
      { _id: req.params.id, shopName: req.shopName },
      { status: 'resolved', resolved_at: new Date() },
      { new: true },
    );
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).json({ message: 'Violation not found' });
    }
  } catch (error) {
    next(error);
  }
};

export const bulkResolve = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ message: 'ids array is required' });
    }
    const result = await Violations.updateMany(
      { _id: { $in: ids }, shopName: req.shopName },
      { status: 'resolved', resolved_at: new Date() },
    );
    res.json({ resolved: result.modifiedCount });
  } catch (error) {
    next(error);
  }
};

export const getStats = async (req, res, next) => {
  try {
    const [active, resolved, total] = await Promise.all([
      Violations.countDocuments({ shopName: req.shopName, status: 'active' }),
      Violations.countDocuments({ shopName: req.shopName, status: 'resolved' }),
      Violations.countDocuments({ shopName: req.shopName }),
    ]);
    res.json({ active, resolved, total });
  } catch (error) {
    next(error);
  }
};
