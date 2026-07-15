import express from 'express';
import { getAccounts } from './accountController';

const router = express.Router();

router.route('/').post(getAccounts);

export default router;
