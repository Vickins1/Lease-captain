
const mongoose = require('mongoose');


const reminderSchema = new mongoose.Schema({
    
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Template',
        required: true
    },
    
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Export the reminder model
const Reminder = mongoose.model('Reminder', reminderSchema);
module.exports = Reminder;
