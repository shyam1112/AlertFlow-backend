import express from 'express';
import { getOrders } from './orderController';

const router = express.Router();

router.route('/').get(getOrders);

export default router;
