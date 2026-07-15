import express from 'express';
import { get, post, deactivate } from './plansController';

const router = express.Router();

router.route('/').get(get).post(post);

router.route('/deactivate').post(deactivate);

export default router;
