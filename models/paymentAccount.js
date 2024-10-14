const mongoose = require('mongoose');

const paymentAccountSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    accountType: {
        type: String,
        enum: ['paybill', 'bank_account', 'till'],
        required: true,
    },
    bankName: {
        type: String,
        required: function() {
            return this.accountType === 'bank_account';
        },
    },
    accountIdentifier: {
        type: String,
        required: function() {
            return this.accountType === 'bank_account';
        },
    },
    tillNumber: {
        type: String,
        required: function() {
            return this.accountType === 'till';
        },
    },
    paybillNumber: {
        type: String,
        required: function() {
            return this.accountType === 'paybill';
        },
    },
    paybillAccountNumber: {
        type: String,
        required: function() {
            return this.accountType === 'paybill';
        },
    },
    paymentStatus: {
        type: String,
        enum: ['active', 'inactive'],
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model('PaymentAccount', paymentAccountSchema);
