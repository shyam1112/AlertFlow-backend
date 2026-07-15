import express from 'express';
import { get, post, put } from './shopSecretsController';

const router = express.Router();

router.route('/').get(get).post(post).put(put);

export default router;
