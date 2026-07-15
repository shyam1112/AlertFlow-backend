import express from 'express';
import { getProducts } from './productController';

const router = express.Router();

router.route('/').get(getProducts);

export default router;
