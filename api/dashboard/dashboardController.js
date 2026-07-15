import Rules from '../rules/rulesModel';
import Violations from '../violations/violationsModel';
import ScanLog from '../scan/scanLogModel';

export const get = async (req, res, next) => {
  try {
    const [activeRules, totalRules, activeViolations, resolvedViolations, violationsByRule, lastScan] =
      await Promise.all([
        Rules.countDocuments({ shopName: req.shopName, is_active: true }),
        Rules.countDocuments({ shopName: req.shopName }),
        Violations.countDocuments({ shopName: req.shopName, status: 'active' }),
        Violations.countDocuments({ shopName: req.shopName, status: 'resolved' }),

        // Group all active violations by rule — every failing product counted
        Violations.aggregate([
          { $match: { shopName: req.shopName, status: 'active' } },
          {
            $group: {
              _id: { rule_name: '$rule_name', resource_type: '$resource_type' },
              count: { $sum: 1 },
              // keep up to 5 sample product titles for the dashboard card
              samples: { $push: '$product_title' },
              last_detected_at: { $max: '$last_detected_at' },
            },
          },
          { $sort: { count: -1 } },
        ]),

        ScanLog.findOne({ shopName: req.shopName })
          .sort({ started_at: -1 })
          .select('started_at completed_at status products_scanned violations_found violations_resolved duration_ms error'),
      ]);

    res.json({
      stats: {
        activeRules,
        totalRules,
        activeViolations,
        resolvedViolations,
        lastScan: lastScan || null,
      },
      // Each entry: { rule_name, resource_type, count, samples (up to 5), last_detected_at }
      violationsByRule: violationsByRule.map(v => ({
        rule_name: v._id.rule_name || 'Unknown Rule',
        resource_type: v._id.resource_type || '—',
        count: v.count,
        samples: v.samples.slice(0, 5),
        last_detected_at: v.last_detected_at,
      })),
    });
  } catch (error) {
    next(error);
  }
};
