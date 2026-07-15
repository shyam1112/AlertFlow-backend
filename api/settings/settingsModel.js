import mongoose from 'mongoose';

const validateEmail = email => {
  if (!email) return true;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const settingsSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true, index: true, unique: true },
    communicationName: { type: String, default: null },
    communicationEmailId: {
      type: String,
      validate: [validateEmail, 'Please enter a valid email address'],
      default: null,
    },
    alert_email: {
      type: String,
      validate: [validateEmail, 'Please enter a valid email address'],
      default: null,
    },
    hourly_email_enabled: { type: Boolean, default: false },
    digest_enabled: { type: Boolean, default: false },
    digest_time: { type: String, default: '00:00' },
    store_timezone: { type: String, default: 'UTC' },
  },
  {
    collection: 'alertflow_settings',
    timestamps: true,
    toJSON: { transform: (_doc, ret) => { delete ret.__v; } },
  },
);

export default mongoose.model('alertflow_settings', settingsSchema);
