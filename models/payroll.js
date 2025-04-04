const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  month: { type: String, required: true }, // e.g., "2025-04"
  salary: { type: Number, required: true },
  deductions: { type: Number, default: 0 },
  netPay: { type: Number, required: true },
  paid: { type: Boolean, default: false },
  paymentDate: { type: Date }
});

module.exports = mongoose.model('Payroll', payrollSchema);