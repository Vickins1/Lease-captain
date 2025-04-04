const mongoose = require('mongoose');

const landReportSchema = new mongoose.Schema({
  landId: { type: mongoose.Schema.Types.ObjectId, ref: 'Land', required: true },
  revenue: { type: Number, required: true },
  month: { type: String, required: true }, // e.g., "2025-04"
  status: { type: String, enum: ['Available', 'Leased'], required: true }
});

module.exports = mongoose.model('LandReport', landReportSchema);