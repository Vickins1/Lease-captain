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
    if (!this.isModified('rentPaid') && !this.isModified('utilityPaid') && 
        !this.isModified('leaseStartDate') && !this.isModified('leaseEndDate')) {
        return next();
    }
    try {
        const Property = mongoose.model('Property');
        const PropertyUnit = mongoose.model('PropertyUnit');

        const property = await Property.findById(this.property);
        const unit = await PropertyUnit.findById(this.unit);
        if (!property || !unit) throw new Error('Property or unit not found');

        const today = new Date();
        const leaseStart = new Date(this.leaseStartDate);
        const paymentDay = property.paymentDay || 1;

        let monthsDue = 0;
        let current = new Date(leaseStart);
        while (current <= today) {
            const dueDate = new Date(current.getFullYear(), current.getMonth(), paymentDay);
            if (dueDate <= today) monthsDue++;
            current.setMonth(current.getMonth() + 1);
        }

        const totalRentExpected = monthsDue * (unit.unitPrice || 0);
        const totalUtilityExpected = monthsDue * (unit.utilities?.reduce((sum, u) => sum + (u.amount || 0), 0) || 0);

        this.rentDue = Math.max(totalRentExpected - (this.rentPaid || 0), 0);
        this.utilityDue = Math.max(totalUtilityExpected - (this.utilityPaid || 0), 0);

        next();
    } catch (error) {
        console.error('Error in tenant pre-save:', error);
        next(error);
    }
});

module.exports = mongoose.model('Tenant', tenantSchema);
