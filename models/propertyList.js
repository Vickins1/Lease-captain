const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema({
    name: { type: String, required: true },
    location: { type: String, required: true },
    status: { type: String, enum: ['available', 'rented', 'maintenance'], default: 'available' },
    price: { type: Number, required: true },
    description: { type: String },
    images: [String],
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bedrooms: { type: Number, default: 0 },
    bathrooms: { type: Number, default: 0 },
    facilities: [String],
    propertyType: { type: String, enum: ['Apartment', 'Bungalow', 'Maisonette', 'Townhouse', 'Single Family Home', 'Farmhouse', ''], default: '' },
    category: { type: String, enum: ['Residential', 'Commercial', 'Agricultural', ''], default: '' }
});

module.exports = mongoose.model('PropertyList', PropertySchema);