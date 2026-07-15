import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const ordersSchema = new Schema(
  {
    shopifyOrderNumber: {
      type: String,
      required: true,
    },
    shopifyOrderId: {
        type: String,
        required: true
    },
    shopifyFulfillmentId: {
        type: String,
        required: true
    },
    isTrackingInfoUpdated: {
        type: Boolean,
        default: false
    }
  },
  {
    collection: 'orders',
    strict: false,
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret._id;
        delete ret.__v;
      },
    },
  },
);

export default mongoose.model('orders', ordersSchema);
