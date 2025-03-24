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

// Pre-save hook to update the tenant's payment records
paymentSchema.pre('save', async function (next) {
    if (!this.isModified('status') || this.status !== 'completed') {
        return next();
    }
    try {
        const Tenant = mongoose.model('Tenant');
        const Payment = mongoose.model('Payment');
        
        const tenant = await Tenant.findById(this.tenant).populate('unit');
        if (!tenant) throw new Error('Tenant not found');

        // Update tenant's payment records based on paymentType
        if (this.paymentType === 'rent') {
            tenant.rentPaid = (tenant.rentPaid || 0) + (this.rentPaid || 0);
        } else if (this.paymentType === 'utility') {
            tenant.utilityPaid = (tenant.utilityPaid || 0) + (this.utilityPaid || 0);
        }

        // Fetch all completed rent payments and sum them up
        const rentPayments = await Payment.find({ 
            tenant: this.tenant, 
            paymentType: 'rent', 
            status: 'completed' 
        });
        const totalRentPaid = rentPayments.reduce((acc, payment) => acc + (payment.rentPaid || 0), 0);

        // Fetch all completed utility payments and sum them up
        const utilityPayments = await Payment.find({ 
            tenant: this.tenant, 
            paymentType: 'utility', 
            status: 'completed' 
        });
        const totalUtilityPaid = utilityPayments.reduce((acc, payment) => acc + (payment.utilityPaid || 0), 0);

        // Calculate total rent expected
        const unitPrice = tenant.unit?.unitPrice || 0;
        const leaseStartDate = new Date(tenant.leaseStartDate);
        const today = new Date();
        const totalMonths = (today.getFullYear() - leaseStartDate.getFullYear()) * 12 + (today.getMonth() - leaseStartDate.getMonth());
        const monthsDue = Math.max(totalMonths + 1, 0);
        const totalRentExpected = monthsDue * unitPrice;

        // Calculate total utility charges
        const unitUtilities = Array.isArray(tenant.unit?.utilities) ? tenant.unit.utilities : [];
        const totalUtilityCharges = unitUtilities.reduce((acc, utility) => acc + (utility.amount || 0), 0);

        // Update tenant's due amounts
        tenant.rentDue = Math.max(totalRentExpected - totalRentPaid, 0);
        tenant.utilityDue = Math.max(totalUtilityCharges - totalUtilityPaid, 0);

        await tenant.save();
        next();
    } catch (error) {
        console.error('Error in pre-save hook:', error);
        next(error);
    }
});

module.exports = model('Payment', paymentSchema);