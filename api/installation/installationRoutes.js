import express from 'express';
import { init, initCallback } from './installationController';

const router = express.Router();

router.route('/').get(init);

router.route('/callback').get(initCallback);

export default router;
