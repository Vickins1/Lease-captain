const mongoose = require('mongoose');
const Payment = require('./payment');

// Define the schema for a Property Unit
const unitSchema = new mongoose.Schema({
    propertyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true,
    },
    unitName: {
        type: String,
        required: true,
    },
    unitType: {
        type: String,
        required: true,
    },
    unitCount: {
        type: Number,
        required: true,
        default: 1,
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0,
    },
    vacantUnits: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    description: {
        type: String,
        default: '',
    },
    utilities: [
        {
            type: {
                type: String,
                required: true,
            },
            amount: {
                type: Number,
                required: true,
                min: 0,
            },
        },
    ],
    tenants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
    }],
    totalRentCollected: {
        type: Number,
        default: 0,
        min: 0,
    },
    rentDue: {
        type: Number,
        default: 0,
        min: 0,
    },
    totalUtilitiesPaid: {
        type: Number,
        default: 0,
        min: 0,
    },
    utilitiesDue: {
        type: Number,
        default: 0,
        min: 0,
    },
    deposit: {
        type: Number,
        required: true,
        min: 0,
    },
}, { timestamps: true });

// Method to calculate total rent for the unit
unitSchema.methods.calculateTotalRent = function() {
    return this.unitPrice * this.unitCount;
};

// Method to fetch payments for the unit and update financials
unitSchema.methods.updateFinancials = async function() {
    try {
        const payments = await Payment.find({ unit: this._id });

        const totalRentCollected = payments.reduce((sum, payment) => sum + (payment.rentPaid || 0), 0);
        const totalUtilitiesPaid = payments.reduce((sum, payment) => sum + (payment.utilityPaid || 0), 0);

        const totalExpectedRent = this.calculateTotalRent();
        const rentDue = totalExpectedRent - totalRentCollected;
        
        const totalUtilitiesExpected = this.utilities.reduce((sum, utility) => sum + (utility.amount || 0), 0);
        const utilitiesDue = totalUtilitiesExpected - totalUtilitiesPaid;

        this.totalRentCollected = totalRentCollected;
        this.totalUtilitiesPaid = totalUtilitiesPaid;
        this.rentDue = Math.max(rentDue, 0);
        this.utilitiesDue = Math.max(utilitiesDue, 0);

        await this.save();
        return this;
    } catch (error) {
        console.error('Error updating unit financials:', error);
        throw error;
    }
};

// Static method to aggregate and update financials for all units of a property
unitSchema.statics.calculateAndSaveForProperty = async function(propertyId) {
    try {
        const units = await this.find({ propertyId });
        const updatedUnits = units.map(unit => unit.updateFinancials());
        await Promise.all(updatedUnits);
    } catch (error) {
        console.error('Error updating property financials:', error);
        throw error;
    }
};

// Create the PropertyUnit model from the schema
const PropertyUnit = mongoose.model('PropertyUnit', unitSchema);

// Export the model for use in other files
module.exports = PropertyUnit;
