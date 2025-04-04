const mongoose = require('mongoose');

const leaseReportSchema = new mongoose.Schema({
  leaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lease', required: true },
  revenue: { type: Number, required: true },
  month: { type: String, required: true }, // e.g., "2025-04"
  status: { type: String, enum: ['Active', 'Expired', 'Pending'], required: true }
});

module.exports = mongoose.model('LeaseReport', leaseReportSchema);