const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); 
const Schema = mongoose.Schema;

// Define the Transaction schema
const transactionSchema = new Schema({
    transactionId: {
        type: String,
        unique: true, 
        default: uuidv4, 
    },
    tenant: {
        type: Schema.Types.ObjectId,
        ref: 'Tenant', 
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    date: {
        type: Date,
        default: Date.now,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        default: 'rent, utility',
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed'], 
        default: 'completed',
    },
    reference: {
        type: String,
        default: null,
    }
});

// Export the Transaction model
module.exports = mongoose.model('Transaction', transactionSchema);
