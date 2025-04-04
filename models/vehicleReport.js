const mongoose = require('mongoose');

const vehicleReportSchema = new mongoose.Schema({
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  parkingFee: { type: Number, required: true },
  month: { type: String, required: true }, // e.g., "2025-04"
  status: { type: String, enum: ['Registered', 'Unregistered'], required: true }
});

module.exports = mongoose.model('VehicleReport', vehicleReportSchema);