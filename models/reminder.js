const mongoose = require('mongoose');
const reminderSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    sendAt: { type: Date, required: true },
    frequency: { type: String, enum: ['once', 'daily', 'weekly', 'monthly'], required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reminder', reminderSchema);