import express from 'express';
import { getMetafieldDefinitions } from './metafieldsController';

const router = express.Router();
router.get('/', getMetafieldDefinitions);
export default router;
