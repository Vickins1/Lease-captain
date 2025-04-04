const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  licensePlate: { type: String, required: true, unique: true },
  make: { type: String, required: true },
  model: { type: String, required: true },
  owner: { type: String, required: true },
  status: { type: String, enum: ['Registered', 'Unregistered'], default: 'Registered' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vehicle', vehicleSchema);