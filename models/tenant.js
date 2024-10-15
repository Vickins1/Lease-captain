const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const moment = require('moment');
const Property = require('../models/property');
const PropertyUnit = require('../models/unit');

const tenantSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: /.+\@.+\..+/
    },
    phone: {
        type: String,
        required: true,
    },
    rentPaid: {
        type: Number,
        default: 0,
    },
    deposit: {
        type: Number,
        required: true,
    },
    property: {
        type: Schema.Types.ObjectId,
        ref: 'Property',
        required: true,
    },
    unit: {
        type: Schema.Types.ObjectId,
        ref: 'PropertyUnit',
        required: true,
    },
    doorNumber: {
        type: String,
        required: true,
    },
    payments: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Payment' }],
        
    leaseStartDate: {
        type: Date,
        required: true,
    },
    leaseEndDate: {
        type: Date,
        required: true,
        validate: {
            validator: function (v) {
                return v > this.leaseStartDate;
            },
            message: (props) => `${props.value} is not a valid lease end date!`
        },
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    username: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
        minlength: 8,
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    resetCode: {
        type: String,
        default: null,
    },
    resetCodeExpiration: {
        type: Date,
        default: null,
    },
    transactions: [{
        type: Schema.Types.ObjectId,
        ref: 'Transaction',
    }],
    maintenanceRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MaintenanceRequest'
    }],
    walletBalance: {
        type: Number,
        default: 0,
    },
    overpayment: {
        type: Number,
        default: 0,
    },
    paymentHistory: [{
        date: {
            type: Date,
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        paymentMethod: {
            type: String,
            required: true,
        },
        note: {
            type: String,
            default: null,
        },
    }],
    utilityPayments: [{
        date: {
            type: Date,
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        note: {
            type: String,
            default: null,
        },
    }],
    utilityPaid: {
        type: Number,
        default: 0,
    },
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true },
});

tenantSchema.methods.getRentDue = async function () {
    const unit = await PropertyUnit.findById(this.unit);
    if (!unit) throw new Error('Unit not found');

    const today = new Date();
    const leaseStartMonth = this.leaseStartDate.getMonth();
    const leaseStartYear = this.leaseStartDate.getFullYear();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const totalMonths = (currentYear - leaseStartYear) * 12 + (currentMonth - leaseStartMonth);
    const totalRentDue = Math.max(totalMonths, 0) * unit.unitPrice;

    return totalRentDue - this.rentPaid;
};

tenantSchema.methods.getUtilityDue = async function () {
    const unit = await PropertyUnit.findById(this.unit);
    if (!unit) throw new Error('Unit not found');

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const totalUtilityPaid = this.utilityPayments.reduce((total, payment) => total + payment.amount, 0);
    const totalUtilityExpected = (currentYear * 12 + currentMonth) - this.utilityPaid; // Example calculation

    return totalUtilityExpected - totalUtilityPaid;
};

tenantSchema.pre('save', async function (next) {
    if (!this.isNew) return next();

    try {
        const property = await Property.findById(this.property);

        if (!property) {
            return next(new Error('Property not found.'));
        }

        if (property.vacant <= 0) {
            return next(new Error('No available units in this property.'));
        }

        property.tenants.push(this._id);
        property.vacant -= 1;
        await property.save();
        next();
    } catch (err) {
        console.error(err);
        next(err);
    }
});

tenantSchema.pre('remove', async function (next) {
    try {
        const property = await Property.findById(this.property);

        if (!property) {
            return next(new Error('Property not found.'));
        }

        property.tenants.pull(this._id);
        property.vacant += 1;
        await property.save();

        next();
    } catch (err) {
        console.error(err);
        next(err);
    }
});

module.exports = mongoose.model('Tenant', tenantSchema);
