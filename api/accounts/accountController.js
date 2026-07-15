import logger from '../../common/logger';

export const getAccounts = async (req, res) => {
  try {
    res.status(200).json({ success: true, accounts: [] });
  } catch (error) {
    logger.error('getAccounts error', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
};
