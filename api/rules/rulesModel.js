import mongoose from 'mongoose';

const rulesSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    resource_type: {
      type: String,
      required: true,
      enum: ['Product', 'Variant', 'Metafield'],
    },
    field_name: { type: String, default: null },
    namespace: { type: String, default: null },
    key: { type: String, default: null },
    operator: {
      type: String,
      required: true,
      enum: ['IS_EMPTY', 'IS_NOT_EMPTY', 'EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GREATER_THAN', 'LESS_THAN'],
    },
    comparison_value: { type: String, default: null },
    is_active: { type: Boolean, default: true, index: true },
    alert_email: { type: Boolean, default: true },
  },
  {
    collection: 'alertflow_rules',
    timestamps: true,
    toJSON: { transform: (_doc, ret) => { delete ret.__v; } },
  },
);

export default mongoose.model('alertflow_rules', rulesSchema);
