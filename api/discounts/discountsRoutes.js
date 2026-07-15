import express from 'express';
import { get, post, deleteData, getAll } from './discountsController';

const router = express.Router();

router.route('/').get(getAll).post(post).delete(deleteData);

router.route('/:id').get(get);

export default router;
