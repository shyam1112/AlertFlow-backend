import express from 'express';
import { get, post, put, deleteData } from './settingsController';

const router = express.Router();

router.route('/').get(get).post(post).put(put).delete(deleteData);

export default router;
