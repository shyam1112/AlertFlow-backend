import logger from '../../common/logger';

export const getBuyerGroups = async (req, res) => {
  try {
    res.status(200).json({ success: true, buyerGroups: [] });
  } catch (error) {
    logger.error('getBuyerGroups error', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
};
