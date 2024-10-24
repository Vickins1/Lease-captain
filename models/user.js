const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

// Define the login activity schema
const loginActivitySchema = new mongoose.Schema({
    loginTime: {
        type: Date,
        required: true,
        default: Date.now
    },
    ipAddress: {
        type: String,
        required: true
    },
    device: {
        type: String,
        required: true
    }
});

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
    roles: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Role'
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    permissions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Permission'
    }],
    loginActivity: [loginActivitySchema]
}, {
    timestamps: true
});

// Passport-Local Mongoose plugin for password hashing
userSchema.plugin(passportLocalMongoose, {
    usernameField: 'username',
    hashField: 'password'
});

// Export the user model
module.exports = mongoose.model('User', userSchema);
