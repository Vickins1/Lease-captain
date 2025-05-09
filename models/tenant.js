const mongoose = require('mongoose');
const { Schema } = mongoose;

const tenantSchema = new Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, match: /.+\@.+\..+/, index: true },
    phone: { type: String, required: true },
    rentPaid: { type: Number, default: 0 },
    utilityPaid: { type: Number, default: 0 },
    rentDue: { type: Number, default: 0 },
    utilityDue: { type: Number, default: 0 },
    overpayment: { type: Number, default: 0 },
    deposit: { type: Number, required: true },
    property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    unit: { type: Schema.Types.ObjectId, ref: 'PropertyUnit', required: true },
    doorNumber: { type: String, required: true },
    payments: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],
    leaseStartDate: { type: Date, required: true },
    leaseEndDate: {
        type: Date,
        required: true,
        validate: {
            validator: function (v) { return v > this.leaseStartDate; },
            message: props => `${props.value} is not a valid lease end date!`
        }
    },
    createdAt: { type: Date, default: Date.now },
    username: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true, minlength: 8 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    resetCode: { type: String, default: null },
    resetCodeExpiration: { type: Date, default: null },
    transactions: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
    maintenanceRequests: [{ type: Schema.Types.ObjectId, ref: 'MaintenanceRequest' }],
    walletBalance: { type: Number, default: 0 }
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
        const leaseEnd = this.leaseEndDate ? new Date(this.leaseEndDate) : null;
        const effectiveEnd = leaseEnd && leaseEnd < today ? leaseEnd : today;

        // Helper: Get months with proration
        function getMonthsBetween(startDate, endDate) {
            const months = [];
            let current = new Date(startDate);
            current.setDate(1);
            while (current <= endDate) {
                const yearMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
                const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
                const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
                const daysInMonth = monthEnd.getDate();
                const effectiveStart = startDate > monthStart ? startDate : monthStart;
                const effectiveMonthEnd = endDate < monthEnd ? endDate : monthEnd;
                const daysActive = Math.ceil((effectiveMonthEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
                const prorationFactor = daysActive / daysInMonth;
                months.push({ yearMonth, prorationFactor });
                current.setMonth(current.getMonth() + 1);
            }
            return months;
        }

        const months = getMonthsBetween(leaseStart, effectiveEnd);
        const monthlyRent = unit.unitPrice || 0;
        const monthlyUtility = unit.utilities?.reduce((sum, u) => sum + (u.amount || 0), 0) || 0;

        let totalRentExpected = 0;
        let totalUtilityExpected = 0;
        for (const { prorationFactor } of months) {
            totalRentExpected += monthlyRent * prorationFactor;
            totalUtilityExpected += monthlyUtility * prorationFactor;
        }

        this.rentDue = Math.max(totalRentExpected - (this.rentPaid || 0), 0);
        this.utilityDue = Math.max(totalUtilityExpected - (this.utilityPaid || 0), 0);

        next();
    } catch (error) {
        console.error('Error in tenant pre-save:', error);
        next(error);
    }
});

module.exports = mongoose.model('Tenant', tenantSchema);