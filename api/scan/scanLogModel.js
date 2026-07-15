import mongoose from 'mongoose';

const scanLogSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true, index: true },
    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: null },
    products_scanned: { type: Number, default: 0 },
    violations_found: { type: Number, default: 0 },
    violations_resolved: { type: Number, default: 0 },
    duration_ms: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    error: { type: String, default: null },
  },
  {
    collection: 'alertflow_scan_logs',
    timestamps: true,
    toJSON: { transform: (_doc, ret) => { delete ret.__v; } },
  },
);

export default mongoose.model('alertflow_scan_logs', scanLogSchema);
