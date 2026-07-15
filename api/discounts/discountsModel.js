import mongoose from 'mongoose';
const discountsSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 200,
      index: true,
    },
    planId: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 200,
    },
    price: {
      type: Number,
      default: null,
    },
    trialDays: {
      type: Number,
      default: null,
    },
  },
  {
    collection: 'discounts',
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret._id;
        delete ret.__v;
      },
    },
  },
);

export default mongoose.model('discounts', discountsSchema);
