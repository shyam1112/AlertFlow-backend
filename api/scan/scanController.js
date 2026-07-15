import { runScan } from '../../common/scanEngine';
import ScanLog from './scanLogModel';
import logger from '../../common/logger';

export const triggerScan = async (req, res, next) => {
  try {
    const shopName = req.shopName;
    res.json({ message: 'Scan started', shopName });
    // Fire-and-forget: errors are logged and recorded in scan log
    runScan(shopName, { sendSummaryEmail: true }).catch(err =>
      logger.error(`Scan failed for ${shopName}: ${err.message}`, { stack: err.stack }),
    );
  } catch (error) {
    next(error);
  }
};

export const getScanLogs = async (req, res, next) => {
  try {
    const logs = await ScanLog.find({ shopName: req.shopName })
      .sort({ started_at: -1 })
      .limit(10);
    res.json({ logs });
  } catch (error) {
    next(error);
  }
};
