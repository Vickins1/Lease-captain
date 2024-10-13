const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the Property schema
const PropertySchema = new Schema({
    name: {
        type: String,
        required: [true, 'Property name is required'],
        trim: true
    },
    address: {
        type: String,
        required: [true, 'Address is required'],
        trim: true
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Owner is required']
    },
    units: [{
        type: Schema.Types.ObjectId,
        ref: 'PropertyUnit',
        default: []
    }],
    propertyType: {
        type: String,
        required: [true, 'Property type is required'],
        trim: true
    },
    tenants: [{ 
        type: Schema.Types.ObjectId,
        ref: 'Tenant' 
    }],
    paymentDay: {
        type: Number,
        required: [true, 'Payment day is required'],
        min: 1,
        max: 31
    },
    rentCollected: {
        type: Number,
        default: 0,
        min: 0 
    },
    rentDue: {
        type: Number,
        default: 0,
        min: 0
    },
    utilitiesCollected: {
        type: Number,
        default: 0,
        min: 0
    },
    utilitiesDue: {
        type: Number,
        default: 0,
        min: 0
    },
    isAvailable: { 
        type: Boolean,
        default: true
    },
    payments: [
        {
            tenantId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Tenant',
                required: [true, 'Tenant ID is required'],
            },
            amount: {
                type: Number,
                required: [true, 'Payment amount is required'],
                min: [0, 'Payment amount cannot be negative'],
            },
            date: {
                type: Date,
                default: Date.now,
            },
        },
    ],
}, { timestamps: true });

module.exports = mongoose.models.Property || mongoose.model('Property', PropertySchema);
