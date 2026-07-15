import express from 'express';
import { approveFulfillmentRequest, cancelFulfillmentRequest, holdFulfillmentRequest, holdReleaseFulfillmentRequest, rejectFulfillmentRequest } from './fulfillmentRequestController';

const router = express.Router();

router.route('/approve').post(approveFulfillmentRequest);
router.route('/reject').post(rejectFulfillmentRequest);
router.route('/hold').post(holdFulfillmentRequest);
router.route('/holdrelease').post(holdReleaseFulfillmentRequest)

// cancel fulfillment request
router.route('/cancelFulfillmentRequest').post(cancelFulfillmentRequest);

export default router;
