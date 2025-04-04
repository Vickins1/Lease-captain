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

// Define the User schema
const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  paymentStatus: {
    status: { 
        type: String, 
        enum: ['pending', 'completed', 'failed'], 
        default: 'pending' 
    },
    transactionId: { 
        type: String 
    },
    amount: { 
        type: Number 
    },
    billingPeriod: { 
        type: String, 
        enum: ['monthly', 'yearly'], 
        default: 'monthly' 
    },
    time: { 
        type: Date, 
        default: Date.now
    }
},
  username: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  phone: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },

  plan: {
    type: String,
    required: true,
    enum: [
      'Basic',
      'Standard-Monthly', 'Standard-Yearly',
      'Pro-Monthly', 'Pro-Yearly',
      'Advanced-Monthly', 'Advanced-Yearly',
      'Enterprise-Monthly', 'Enterprise-Yearly',
      'Premium'
    ],
    default: 'Basic'
  },
  
  tenantsLimit: {
    type: Number,
    default: 0,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  verificationToken: {
    type: String,
  },
  verificationExpires: {
    type: Date,
  },
  resetPasswordCode: {
    type: String,
  },
  resetPasswordExpires: {
    type: Date,
  },
  loginActivity: [loginActivitySchema],
  isNewUser: {  
    type: Boolean,
    default: true
  }
}, { timestamps: true });

userSchema.methods.getPaymentStatus = async function() {
  return {
    status: this.paymentStatus.status,
    transactionId: this.paymentStatus.transactionId,
    amount: this.paymentStatus.amount,
    billingPeriod: this.paymentStatus.billingPeriod 
  };
};

// Attach the passport-local-mongoose plugin
userSchema.plugin(passportLocalMongoose, {
  usernameField: 'email' 
});

// Export the user model
module.exports = mongoose.model('User', userSchema);