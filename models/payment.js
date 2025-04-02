const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const paymentSchema = new Schema({
    owner: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    tenant: { 
        type: Schema.Types.ObjectId, 
        ref: 'Tenant', 
        required: true 
    },
    tenantName: { 
        type: String, 
        required: true 
    },
    property: { 
        type: Schema.Types.ObjectId, 
        ref: 'Property', 
        required: true 
    },
    unit: { 
        type: Schema.Types.ObjectId, 
        ref: 'PropertyUnit', 
        required: false 
    },
    doorNumber: { 
        type: String, 
        required: [true, 'Door number is required'] 
    },
    amount: { 
        type: Number, 
        required: true, 
        min: [0, 'Amount must be non-negative'] 
    },
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
        min: 0 
    },
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
    rentPaid: { 
        type: Number, 
        default: 0 
    },
    utilityPaid: { 
        type: Number, 
        default: 0 
    },
    transactionId: {
        type: String,
        required: true,
        unique: true
    }
}, {
    timestamps: true
});

// Static method to update payment status
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
        await payment.save();

        return payment;
    } catch (error) {
        console.error('Error updating payment status:', error);
        throw error;
    }
};

paymentSchema.pre('save', async function (next) {
    if (!this.isModified('status') || this.status !== 'completed') return next();
    try {
        const Tenant = mongoose.model('Tenant');
        const tenant = await Tenant.findById(this.tenant);
        if (!tenant) throw new Error('Tenant not found');

        if (this.paymentType === 'rent') {
            tenant.rentPaid = (tenant.rentPaid || 0) + (this.rentPaid || 0);
        } else if (this.paymentType === 'utility') {
            tenant.utilityPaid = (tenant.utilityPaid || 0) + (this.utilityPaid || 0);
        }

        await tenant.save();
        next();
    } catch (error) {
        console.error('Error in payment pre-save:', error);
        next(error);
    }
});

module.exports = model('Payment', paymentSchema);