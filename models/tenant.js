const mongoose = require('mongoose');
const Schema = mongoose.Schema;

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
        default: 0,
    },
    utilityPaid: {
        type: Number,
        default: 0,
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


tenantSchema.pre('save', async function (next) {
    const PropertyUnit = require('../models/unit');
    const Property = require('../models/property');
    const Payment = require('../models/payment');

    if (!this.isModified('payments') && !this.isModified('leaseStartDate') && !this.isModified('leaseEndDate')) {
        return next();
    }

    try {
        const unit = await PropertyUnit.findById(this.unit);
        if (!unit) throw new Error('Unit not found');

        const property = await Property.findById(this.property);
        if (!property) throw new Error('Property not found');

        const today = new Date();
        const leaseStartDate = new Date(this.leaseStartDate);
        const paymentDay = property.paymentDay || 1;

        // Calculate months due based on payment day
        let monthsDue = 0;
        let currentDate = new Date(leaseStartDate);
        while (currentDate <= today) {
            const dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), paymentDay);
            if (dueDate <= today) {
                monthsDue++;
            }
            currentDate.setMonth(currentDate.getMonth() + 1);
            currentDate.setDate(leaseStartDate.getDate());
        }

        const totalRentExpected = monthsDue * unit.unitPrice;
        const rentPayments = await Payment.find({ tenant: this._id, paymentType: 'rent' });
        const totalRentPaid = rentPayments.reduce((total, payment) => total + (payment.amount || 0), 0);

        this.rentDue = Math.max(totalRentExpected - totalRentPaid, 0);
        this.rentPaid = totalRentPaid;
        this.overpayment = Math.max(totalRentPaid - totalRentExpected, 0);

        const utilityPayments = await Payment.find({ tenant: this._id, paymentType: 'utility' });
        const totalUtilityPaid = utilityPayments.reduce((total, payment) => total + (payment.amount || 0), 0);
        const totalUtilityCharges = unit.utilities ? unit.utilities.reduce((total, utility) => total + (utility.amount || 0), 0) : 0;
        this.utilityDue = Math.max(totalUtilityCharges - totalUtilityPaid, 0);
        this.utilityPaid = totalUtilityPaid;

        next();
    } catch (err) {
        console.error('Pre-save hook error:', err.message);
        next(err);
    }
});

module.exports = mongoose.model('Tenant', tenantSchema);
