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
  phone: {
    type: String,
    required: true,
    match: /^[0-9]{10}$/
  },
  plan: {
    type: String,
    enum: ['Basic', 'Standard', 'Pro', 'Advanced', 'Premium'],
    default: 'Basic'
  },
  tenantsCount: {
    type: Number,
    default: 10
  },
  roles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role'
  }],
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
  usernameField: 'username' // Configures 'username' as the username field
});

// Export the user model
module.exports = mongoose.model('User', userSchema);
