import logger from '../../common/logger';

export const getProducts = async (req, res) => {
  try {
    res.status(200).json({ success: true, products: [] });
  } catch (error) {
    logger.error('getProducts error', { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
};
