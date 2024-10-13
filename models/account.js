const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    accountId: { type: String, required: true },
    apiKey: { type: String, required: true },
    webhookUrl: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    connectedAt: { type: Date, default: Date.now }
});

const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
