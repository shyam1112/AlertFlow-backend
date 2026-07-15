import express from 'express';
import { getAll, get, create, resolve, bulkResolve, getStats } from './violationsController';

const router = express.Router();

router.route('/stats').get(getStats);
router.route('/').get(getAll).post(create);
router.route('/bulk-resolve').patch(bulkResolve);
router.route('/:id').get(get);
router.route('/:id/resolve').patch(resolve);

export default router;
