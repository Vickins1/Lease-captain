const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const supportMessageSchema = new Schema({
    email: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
