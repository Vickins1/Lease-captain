const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const PropertyUnit = require('../models/unit');
const Payment = require('../models/payment');

const tenantSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: /.+\@.+\..+/,
        index: true
    },
    phone: {
        type: String,
        required: true
    },
    rentPaid: {
        type: Number,
        default: 0
    },
    rentDue: {
        type: Number,
        default: 0  
    },
    utilityDue: {
        type: Number,
        default: 0 
    },
    overpayment: {
        type: Number,
        default: 0
    },
    deposit: {
        type: Number,
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
        required: true
    },
    doorNumber: {
        type: String,
        required: true
    },
    payments: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Payment' 
    }],
    leaseStartDate: {
        type: Date,
        required: true
    },
    leaseEndDate: {
        type: Date,
        required: true,
        validate: {
            validator: function (v) {
                return v > this.leaseStartDate;
            },
            message: props => `${props.value} is not a valid lease end date!`
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    username: {
        type: String,
        required: true,
        unique: true,
        index: true 
    },
    password: {
        type: String,
        required: true,
        minlength: 8
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    resetCode: {
        type: String,
        default: null
    },
    resetCodeExpiration: {
        type: Date,
        default: null
    },
    transactions: [{
        type: Schema.Types.ObjectId,
        ref: 'Transaction'
    }],
    maintenanceRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MaintenanceRequest'
    }],
    walletBalance: {
        type: Number,
        default: 0
    },
}, { timestamps: true });

// Pre-save hook to automatically calculate and update dues
tenantSchema.pre('save', async function (next) {
    if (!this.isModified('payments') && !this.isModified('leaseStartDate') && !this.isModified('leaseEndDate')) {
        return next(); // Skip calculation if relevant fields are not modified
    }

    try {
        // Fetch the unit
        const unit = await PropertyUnit.findById(this.unit);
        if (!unit) throw new Error('Unit not found');

        // Calculate the rent due
        const today = new Date();
        const leaseStartDate = this.leaseStartDate;
        const totalMonths = (today.getFullYear() - leaseStartDate.getFullYear()) * 12 + (today.getMonth() - leaseStartDate.getMonth());
        const monthsDue = Math.max(totalMonths + 1, 0);
        const totalRentExpected = monthsDue * unit.unitPrice;

        // Calculate the total rent paid
        const rentPayments = await Payment.find({ tenant: this._id, type: 'rent' });
        const totalRentPaid = rentPayments.reduce((total, payment) => total + (payment.amount || 0), 0);

        // Set rentDue and overpayment
        this.rentDue = Math.max(totalRentExpected - totalRentPaid, 0);
        this.overpayment = Math.max(totalRentPaid - totalRentExpected, 0);

        // Calculate the utility due
        const utilityPayments = await Payment.find({ tenant: this._id, type: 'utility' });
        const totalUtilityPaid = utilityPayments.reduce((total, payment) => total + (payment.amount || 0), 0);

        // Handle cases where utilities might not exist on a unit
        const totalUtilityCharges = unit.utilities ? unit.utilities.reduce((total, utility) => total + (utility.amount || 0), 0) : 0;
        this.utilityDue = Math.max(totalUtilityCharges - totalUtilityPaid, 0);

        next();
    } catch (err) {
        next(err);
    }
});

// Method to calculate and update dues manually
tenantSchema.methods.calculateAndUpdateDues = async function () {
    try {
        const unit = await PropertyUnit.findById(this.unit);
        if (!unit) throw new Error('Unit not found');

        // Rent and utility due calculations
        const today = new Date();
        const leaseStartDate = this.leaseStartDate;
        const totalMonths = (today.getFullYear() - leaseStartDate.getFullYear()) * 12 + (today.getMonth() - leaseStartDate.getMonth());
        const monthsDue = Math.max(totalMonths + 1, 0);
        const totalRentExpected = monthsDue * unit.unitPrice;

        // Rent payments
        const rentPayments = await Payment.find({ tenant: this._id, type: 'rent' });
        const totalRentPaid = rentPayments.reduce((total, payment) => total + (payment.amount || 0), 0);

        this.rentDue = Math.max(totalRentExpected - totalRentPaid, 0);
        this.overpayment = Math.max(totalRentPaid - totalRentExpected, 0);

        // Utility payments and charges
        const utilityPayments = await Payment.find({ tenant: this._id, type: 'utility' });
        const totalUtilityPaid = utilityPayments.reduce((total, payment) => total + (payment.amount || 0), 0);
        const totalUtilityCharges = unit.utilities ? unit.utilities.reduce((total, utility) => total + (utility.amount || 0), 0) : 0;

        this.utilityDue = Math.max(totalUtilityCharges - totalUtilityPaid, 0);

        await this.save(); // Save updated dues
    } catch (err) {
        console.error('Error calculating dues:', err);
    }
};

// Export the Tenant model
module.exports = mongoose.model('Tenant', tenantSchema);
