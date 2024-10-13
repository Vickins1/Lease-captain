const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    invoiceId: { type: String, required: true },
    property: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    dateIssued: { type: Date, default: Date.now },
    status: { type: String, enum: ['paid', 'unpaid'], default: 'unpaid' },
});

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;
