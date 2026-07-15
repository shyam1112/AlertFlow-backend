import express from 'express';
import { getContacts } from './contactController';

const router = express.Router();

router.route('/').post(getContacts);

export default router;
