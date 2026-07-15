import express from 'express';
import { get } from './dashboardController';

const router = express.Router();

router.route('/').get(get);

export default router;
