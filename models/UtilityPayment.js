const mongoose = require('mongoose');

const utilityPaymentSchema = new mongoose.Schema({
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    utilityType: { type: String, required: true }
});

const UtilityPayment = mongoose.model('UtilityPayment', utilityPaymentSchema);

module.exports = UtilityPayment;
