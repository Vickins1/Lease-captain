const mongoose = require('mongoose');
const Payment = require('./payment');

// Define the schema for a Property Unit
const unitSchema = new mongoose.Schema({
    propertyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
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
 
    deposit: {
        type: Number,
        required: true,
        min: 0,
    },
}, { timestamps: true });


// Create the PropertyUnit model from the schema
const PropertyUnit = mongoose.model('PropertyUnit', unitSchema);

// Export the model for use in other files
module.exports = PropertyUnit;
