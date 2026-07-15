import logger from '../../common/logger';

export const getOrders = async (req, res) => {
  try {
    res.status(200).json({ success: true, orders: [] });
  } catch (error) {
    logger.error('getOrders error', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
};
