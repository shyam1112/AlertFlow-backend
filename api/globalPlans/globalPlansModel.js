import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const globalPlansSchema = new Schema(
  {
    id: {
      type: String,
      unique: true,
      minlength: 1,
      maxlength: 200,
    },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 200,
    },
    type: {
      type: String,
      required: true,
      enum: ['monthly', 'yearly', 'onetime'],
      default: 'monthly',
    },
    price: {
      type: Number,
      required: true,
    },
    originalPrice: {
      type: Number,
      default: null,
    },
    trialDays: {
      type: Number,
      default: null,
    },
    description: {
      type: String,
      default: null,
      minlength: 1,
      maxlength: 500,
    },
    isRecommended: {
      type: Boolean,
      default: false,
    },
  },
  {
    collection: 'globalPlans',
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret._id;
        delete ret.__v;
      },
    },
  },
);

export default mongoose.model('globalplans', globalPlansSchema);
