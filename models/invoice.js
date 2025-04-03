const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const InvoiceSchema = new Schema({
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    invoiceNumber: { 
        type: String, 
        required: true, 
        unique: true 
    },
    transactionId: { 
        type: String 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    billingPeriod: { 
        type: String, 
        enum: ['monthly', 'yearly'], 
        default: 'monthly' 
    },
    status: { 
        type: String, 
        enum: ['pending', 'paid', 'overdue'], 
        default: 'pending' 
    },
    dueDate: { 
        type: Date, 
        required: true 
    },
    time: { 
        type: Date, 
        default: Date.now
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Register the model
module.exports = mongoose.model('Invoice', InvoiceSchema);