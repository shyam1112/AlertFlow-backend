import mongoose from 'mongoose';

const violationsSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true, index: true },
    product_id: { type: String, default: null },
    product_title: { type: String, default: null },
    product_handle: { type: String, default: null },
    rule_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'alertflow_rules',
      default: null,
    },
    rule_name: { type: String, default: null },
    resource_type: { type: String, default: null },
    current_value: { type: String, default: null },
    reason: { type: String, default: null },
    status: {
      type: String,
      enum: ['active', 'resolved'],
      default: 'active',
      index: true,
    },
    first_detected_at: { type: Date, default: Date.now },
    last_detected_at: { type: Date, default: Date.now },
    resolved_at: { type: Date, default: null },
  },
  {
    collection: 'alertflow_violations',
    timestamps: true,
    toJSON: { transform: (_doc, ret) => { delete ret.__v; } },
  },
);

// Unique index: one active violation per product+rule combination
violationsSchema.index({ shopName: 1, product_id: 1, rule_id: 1 }, { unique: false });

export default mongoose.model('alertflow_violations', violationsSchema);
