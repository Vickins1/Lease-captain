const mongoose = require('mongoose');

// Define the Role schema
const roleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true 
    },
    permissions: {
        type: [String], 
        default: [] 
    },
    createdAt: {
        type: Date,
        default: Date.now 
    }
});

// Create the Role model
const Role = mongoose.model('Role', roleSchema);

// Export the model
module.exports = Role;
