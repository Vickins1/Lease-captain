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
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    }
});

tenantSchema.methods.getRentDue = async function () {
    const unit = await PropertyUnit.findById(this.unit);
    if (!unit) throw new Error('Unit not found');

    const today = new Date();
    const leaseStartDate = this.leaseStartDate;
    
    const totalMonths = 
        (today.getFullYear() - leaseStartDate.getFullYear()) * 12 +
        (today.getMonth() - leaseStartDate.getMonth());

    const monthsDue = Math.max(totalMonths + 1, 0);

    const totalRentExpected = monthsDue * unit.unitPrice;

    const rentPayments = await Payment.find({
        tenant: this._id,
        type: 'rent' 
    });

    const totalRentPaid = rentPayments.reduce(
        (total, payment) => total + (payment.amount || 0),
        0
    );

    const rentDue = Math.max(totalRentExpected - totalRentPaid, 0);

    return rentDue;
};


tenantSchema.methods.getUtilityDue = async function () {
    const unit = await PropertyUnit.findById(this.unit);
    if (!unit) throw new Error('Unit not found');

    const utilityBills = this.utilityBills || [];

    const totalUtilityCharges = utilityBills.reduce(
        (total, bill) => total + (bill.amount || 0), 
        0
    );

    const utilityPayments = await Payment.find({
        tenant: this._id,
        type: 'utility'
    });

    const totalUtilityPaid = utilityPayments.reduce(
        (total, payment) => total + (payment.amount || 0),
        0
    );

    const utilityDue = Math.max(totalUtilityCharges - totalUtilityPaid, 0);

    return utilityDue;
};




// Export the Tenant model
module.exports = mongoose.model('Tenant', tenantSchema);
