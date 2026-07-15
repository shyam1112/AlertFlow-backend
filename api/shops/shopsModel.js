import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const shopsSchema = new Schema(
  {
    name: { type: String, required: true },
    myshopify_domain: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true },
    country: { type: String, required: true },
    country_code: { type: String, required: true },
    currency: { type: String, required: true },
    phone: { type: String },
    domain: { type: String },
    updated_at: { type: String },
    primary_locale: { type: String },
  },
  {
    collection: 'shops',
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

export default mongoose.model('shops', shopsSchema);
