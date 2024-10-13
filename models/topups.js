const mongoose = require('mongoose');

const topupSchema = new mongoose.Schema({
    amount: {
        type: Number,
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Topup = mongoose.model('Topup', topupSchema);
module.exports = Topup;
