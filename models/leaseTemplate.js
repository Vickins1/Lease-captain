const mongoose = require('mongoose');

const leaseTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['Residential', 'Commercial', 'Land'], required: true },
  content: { type: String }, // Could store HTML or text for the template
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LeaseTemplate', leaseTemplateSchema);