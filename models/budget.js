const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
  category: { type: String, enum: ['Leases', 'Properties', 'Lands', 'Vehicles', 'Staff', 'Miscellaneous'], required: true },
  amount: { type: Number, required: true },
  period: { type: String, required: true }, // e.g., "2025-04" (monthly budget)
  description: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Budget', budgetSchema);