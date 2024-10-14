const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

// Define the user schema
const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        unique: true, 
        required: true 
    },
    email: { 
        type: String, 
        unique: true, 
        required: true 
    },
    password: {  
        type: String,
        required: true,
    },
    role: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Role'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true 
});

// Apply the passport-local-mongoose plugin to the user schema
userSchema.plugin(passportLocalMongoose, {
    usernameField: 'username', 
    hashField: 'password' // Specify the hashField if not default
});

// Export the user model
module.exports = mongoose.model('User', userSchema);
