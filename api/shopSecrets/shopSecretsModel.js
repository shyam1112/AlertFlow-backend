import mongoose from 'mongoose';

const shopSecretsSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    permanentToken: { type: String, required: true },
    chargeId: { type: String, default: null },
    chargeStatus: {
      type: String,
      default: 'pending',
      enum: ['accepted', 'active', 'declined', 'uninstalled', 'pending'],
      required: true,
    },
    planId: { type: String, default: null },
  },
  {
    collection: 'shopSecrets',
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
      },
    },
  },
);

export default mongoose.model('shopsecrets', shopSecretsSchema);
