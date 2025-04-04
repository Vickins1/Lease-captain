const mongoose = require('mongoose');

const parkingSpaceSchema = new mongoose.Schema({
  spaceNumber: { type: String, required: true, unique: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  status: { type: String, enum: ['Available', 'Occupied'], default: 'Available' },
  location: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ParkingSpace', parkingSpaceSchema);