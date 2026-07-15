import express from 'express';
import { getAll, get, create, update, remove, toggle } from './rulesController';

const router = express.Router();

router.route('/').get(getAll).post(create);
router.route('/:id').get(get).put(update).delete(remove);
router.route('/:id/toggle').patch(toggle);

export default router;
