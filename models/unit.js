const mongoose = require('mongoose');

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
    totalUtilitiesCollected: {
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

// Static method to aggregate data for a specific property
unitSchema.statics.calculateAggregatesForProperty = async function(propertyId) {
    const units = await this.find({ propertyId });
    
    // Ensure that 'units' is not null or undefined to avoid errors
    if (!units || units.length === 0) {
        return {
            totalRentCollected: 0,
            totalUtilitiesCollected: 0,
            utilitiesDue: 0,
        };
    }

    return units.reduce((acc, unit) => {
        acc.totalRentCollected += unit.calculateTotalRent();
        acc.totalUtilitiesCollected += unit.totalUtilitiesCollected;
        acc.utilitiesDue += unit.utilitiesDue;
        return acc;
    }, {
        totalRentCollected: 0,
        totalUtilitiesCollected: 0,
        utilitiesDue: 0,
    });
};

// Create the PropertyUnit model from the schema
const PropertyUnit = mongoose.model('PropertyUnit', unitSchema);

// Export the model for use in other files
module.exports = PropertyUnit;
