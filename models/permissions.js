const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true 
    },
    description: { 
        type: String 
    }
});

module.exports = mongoose.model('Permission', permissionSchema);
