const mongoose = require('mongoose');

const MaintenanceRequestSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    description: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'in-progress', 'completed'], 
        default: 'pending' 
    },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
    date: { type: Date, default: Date.now },
    scheduleDate: { type: Date } 
});

const MaintenanceRequest = mongoose.model('MaintenanceRequest', MaintenanceRequestSchema);
module.exports = MaintenanceRequest;
