const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const topupSchema = new Schema({
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount must be a positive number'],
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

// Export the TopUp model
const TopUp = mongoose.model('TopUp', topupSchema);
module.exports = TopUp;
