const mongoose = require('mongoose');

const landSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  size: { type: Number, required: true },
  owner: { type: String, required: true },
  status: { type: String, enum: ['Available', 'Leased', 'Under Review'], default: 'Available' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Land', landSchema);