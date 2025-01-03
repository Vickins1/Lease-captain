const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const supportMessageSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    number: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    reviewcheck: {
        type: Boolean,
        required: true
    },
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
