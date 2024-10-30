const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const Tenant = require('./tenant')

const paymentSchema = new Schema({
    tenant: { 
        type: Schema.Types.ObjectId, 
        ref: 'Tenant', 
        required: true },
    tenantName: { 
        type: String, 
        required: true },
    property: { 
        type: Schema.Types.ObjectId, 
        ref: 'Property', 
        required: true },

    unit: { 
        type: Schema.Types.ObjectId, 
        ref: 'PropertyUnit', 
        required: false },

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
    rentPaid: { 
        type: Number, 
        default: 0 },

    utilityPaid: { 
        type: Number, 
        default: 0 },

    transactionId: {
        type: String,
        required: true,
        unique: true
    },
}, {
    timestamps: true
});

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
    if (this.status !== 'completed') {
        return next(); // Skip if the payment is not marked as 'completed'
    }

    try {
        const tenant = await Tenant.findById(this.tenant);
        if (!tenant) throw new Error('Tenant not found');

        // Determine if this payment is for rent or utility
        if (this.paymentType === 'rent') {
            tenant.rentPaid += this.amount;
        } else if (this.paymentType === 'utility') {
            tenant.utilityPaid += this.amount;
        }

        // Fetch all completed rent payments and sum them up
        const rentPayments = await mongoose.model('Payment').find({ 
            tenant: this.tenant, 
            paymentType: 'rent', 
            status: 'completed' 
        });
        const totalRentPaid = rentPayments.reduce((acc, payment) => acc + (payment.amount || 0), 0);

        // Fetch all completed utility payments and sum them up
        const utilityPayments = await mongoose.model('Payment').find({ 
            tenant: this.tenant, 
            paymentType: 'utility', 
            status: 'completed' 
        });
        const totalUtilityPaid = utilityPayments.reduce((acc, payment) => acc + (payment.amount || 0), 0);

        // Handle cases where tenant's unit or utilities might not be defined
        const unitPrice = tenant.unit?.unitPrice || 0;
        const leaseStartDate = new Date(tenant.leaseStartDate);
        const today = new Date();
        const totalMonths = (today.getFullYear() - leaseStartDate.getFullYear()) * 12 + (today.getMonth() - leaseStartDate.getMonth());
        const monthsDue = Math.max(totalMonths + 1, 0);
        const totalRentExpected = monthsDue * unitPrice;

        // Handle cases where utilities might not exist for the unit
        const unitUtilities = Array.isArray(tenant.unit?.utilities) ? tenant.unit.utilities : [];
        const totalUtilityCharges = unitUtilities.reduce((acc, utility) => acc + (utility.amount || 0), 0);

        // Calculate the rent and utility due (ensure default values to avoid NaN)
        tenant.rentDue = Math.max(totalRentExpected - (totalRentPaid || 0), 0);
        tenant.utilityDue = Math.max(totalUtilityCharges - (totalUtilityPaid || 0), 0);

        await tenant.save();
        next();
    } catch (error) {
        next(error);
    }
});


module.exports = model('Payment', paymentSchema);

