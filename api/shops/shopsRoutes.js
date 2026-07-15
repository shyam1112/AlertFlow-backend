import express from 'express';
import { get, post, put, deleteData } from './shopsController';

const router = express.Router();

router.route('/').get(get).post(post).put(put).delete(deleteData);

export default router;
