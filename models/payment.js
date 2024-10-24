const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const paymentSchema = new Schema({
    tenant: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    tenantName: { type: String, required: true },
    property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    unit: { type: Schema.Types.ObjectId, ref: 'PropertyUnit', required: false },
    doorNumber: { 
        type: String, 
        required: [true, 'Door number is required'] },
    amount: { 
        type: Number, 
        required: true, 
        min: [0, 'Amount must be non-negative'] },
    datePaid: { 
        type: Date, 
        default: Date.now 
    },
    method: { 
        type: String, 
        required: [true, 'Payment method is required'] 
    },
    totalPaid: { 
        type: Number, 
        required: [true, 'Total amount paid is required'], 
        min: 0 },
    due: { 
        type: Number, 
        required: true 
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed'],
        default: 'pending'
    },
    paymentType: {
        type: String,
        enum: ['rent', 'utility', 'other'],
        required: true
    },
    rentPaid: { type: Number, default: 0 },
    utilityPaid: { type: Number, default: 0 },
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
}, {
    timestamps: true
});

// Static method to update payment status and corresponding fields
paymentSchema.statics.updatePaymentStatus = async function(transactionId) {
    try {
        const payment = await this.findOne({ transactionId });

        if (!payment) {
            console.log(`Payment not found for transaction ID: ${transactionId}`);
            return null;
        }

        if (payment.status === 'completed') {
            console.log(`Payment already completed for transaction ID: ${transactionId}`);
            return payment; 
        }
        payment.status = 'completed';

        if (payment.paymentType === 'rent') {
            payment.rentPaid = payment.amount;
            console.log(`Rent payment updated for transaction ID: ${transactionId}`);
        } else if (payment.paymentType === 'utility') {
            payment.utilityPaid = payment.amount;
            console.log(`Utility payment updated for transaction ID: ${transactionId}`);
        }

        await payment.save();

        return payment;
    } catch (error) {
        console.error('Error updating payment status:', error);
        throw error;
    }
};

// Export the payment model
module.exports = model('Payment', paymentSchema);
