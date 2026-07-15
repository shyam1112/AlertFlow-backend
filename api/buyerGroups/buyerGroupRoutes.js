import express from 'express';
import { getBuyerGroups } from './buyerGroupController';

const router = express.Router();

router.route('/').post(getBuyerGroups);

export default router;
