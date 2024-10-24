const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const loginActivitySchema = new Schema({
    loginTime: {
        type: Date,
        required: true
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

const userSchema = new Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    loginActivity: [loginActivitySchema]
});

const User = mongoose.model('User', userSchema);
module.exports = User;
