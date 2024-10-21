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
    }]
}, {
    timestamps: true
});

userSchema.plugin(passportLocalMongoose, {
    usernameField: 'username',
    hashField: 'password'
});

// Export the user model
module.exports = mongoose.model('User', userSchema);
