const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    tenantName: { type: String, required: true },
    property: { type: String, required: true },
    unit: { type: String, required: true },
    doorNumber: { type: String, required: true },
    amount: { type: Number, required: true },
    datePaid: { type: Date, default: Date.now },
    method: { type: String, enum: ['mobile', 'cash', 'bank'], required: true },
    totalPaid: { type: Number, required: true },
    due: { type: Number, required: true },
    status: { type: String, enum: ['completed', 'pending', 'failed'], default: 'pending' },
    paymentType: { type: String, enum: ['rent', 'utility', 'other'], required: true },
    rentPaid: { type: Number, default: 0 },
    utilityPaid: { type: Number, default: 0 },
    transactionId: { type: String, required: true, unique: true } 
}, {
    timestamps: true
});

// Function to update the payment status
paymentSchema.statics.updatePaymentStatus = async function(transactionId) {
    try {
        const payment = await this.findOne({ transactionId });

        if (payment) {
            payment.status = 'completed';
            await payment.save();
            console.log(`Payment status updated for transaction ID: ${transactionId}`);
        } else {
            console.log(`Payment not found for transaction ID: ${transactionId}`);
        }
    } catch (error) {
        console.error('Error updating payment status:', error);
    }
};

module.exports = mongoose.model('Payment', paymentSchema);
