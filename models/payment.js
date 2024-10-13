const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    tenantName: { type: String, required: true },
    property: { type: String, required: true },
    amount: { type: Number, required: true },
    datePaid: { type: Date, default: Date.now },
    method: { type: String, required: true },
    totalPaid: { type: Number, required: true },
    due: { type: Number, required: true },
    status: { type: String, required: true },
});

module.exports = mongoose.model('Payment', paymentSchema);
