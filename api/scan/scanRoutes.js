import express from 'express';
import { triggerScan, getScanLogs } from './scanController';

const router = express.Router();

router.post('/', triggerScan);
router.get('/logs', getScanLogs);

export default router;
