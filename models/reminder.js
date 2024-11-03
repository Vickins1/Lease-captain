const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    owner: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    sendAt: {
        type: Date,
        required: true
    },
    frequency: {
        type: String,
        enum: ['once', 'daily', 'weekly', 'monthly'],
        default: 'once',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
    }
}, {
    timestamps: true
});

const Reminder = mongoose.model('Reminder', reminderSchema);
module.exports = Reminder;
