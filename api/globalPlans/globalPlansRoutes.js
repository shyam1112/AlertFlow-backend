import express from 'express';
import { getAll, get, post, put, deleteData } from './globalPlansController';

const router = express.Router();

router.route('/').get(getAll).post(post);

router.route('/:id').get(get).put(put).delete(deleteData);

export default router;
