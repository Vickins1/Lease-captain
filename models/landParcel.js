const mongoose = require('mongoose');

const landParcelSchema = new mongoose.Schema({
  landId: { type: mongoose.Schema.Types.ObjectId, ref: 'Land', required: true },
  parcelNumber: { type: String, required: true },
  size: { type: Number, required: true }, // Size of the parcel
  status: { type: String, enum: ['Available', 'Leased'], default: 'Available' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LandParcel', landParcelSchema);