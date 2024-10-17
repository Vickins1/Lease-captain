const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const Property = require('../models/property');
const PropertyUnit = require('../models/unit');

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
        index: true // Index for better performance
    },
    phone: {
        type: String,
        required: true
    },
    rentPaid: {
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
    overpayment: {
        type: Number,
        default: 0
    },
    paymentHistory: [{
        date: {
            type: Date,
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        paymentMethod: {
            type: String,
            required: true
        },
        note: {
            type: String,
            default: null
        }
    }],
    utilityPayments: [{
        date: {
            type: Date,
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        note: {
            type: String,
            default: null
        }
    }],
    utilityPaid: {
        type: Number,
        default: 0
    },
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    }
});

// Methods for rent and utility due calculations
tenantSchema.methods.getRentDue = async function () {
    const unit = await PropertyUnit.findById(this.unit);
    if (!unit) throw new Error('Unit not found');
    const today = new Date();
    const leaseStartMonth = this.leaseStartDate.getMonth();
    const leaseStartYear = this.leaseStartDate.getFullYear();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const totalMonths = (currentYear - leaseStartYear) * 12 + (currentMonth - leaseStartMonth);
    const totalRentExpected = Math.max(totalMonths, 0) * unit.unitPrice;
    const totalRentPaid = this.rentPayments.reduce((total, payment) => total + payment.amount, 0);
    const rentDue = totalRentExpected - totalRentPaid;
    return Math.max(rentDue, 0);
};

// Export the Tenant model
module.exports = mongoose.model('Tenant', tenantSchema);
