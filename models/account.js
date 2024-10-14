const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    accountEmail: { type: String, required: true },
    apiKey: { type: String, required: true },
    accountId: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], required: true },
    webhookUrl: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const Account = mongoose.model('Account', accountSchema);

module.exports = Account;
