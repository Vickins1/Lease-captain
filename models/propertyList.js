const mongoose = require('mongoose');

const propertyListSchema = new mongoose.Schema({
    name: { type: String, required: true },
    location: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['available', 'rented', 'maintenance'], 
        default: 'available' 
    },
    price: { type: Number, required: true },
    images: [{ type: String }], // Array of image URLs
    description: { type: String }, // New description field
    owner: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('PropertyList', propertyListSchema);