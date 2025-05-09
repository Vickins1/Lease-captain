const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/user');
const dns = require('dns');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Rate limiter for signup attempts
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many signup attempts from this IP, please try again after 15 minutes'
});

router.post('/signup', 
  signupLimiter,
  async (req, res) => {
    const { username, email, password, phone, plan, 'confirm-password': confirmPassword, formLoadedAt } = req.body;

    try {
      const errors = [];

      // Timestamp check (require at least 3 seconds)
      const submissionTime = Date.now();
      const loadTime = parseInt(formLoadedAt, 10);
      if (!loadTime || submissionTime - loadTime < 3000) {
        errors.push('Form submitted too quickly. Please try again.');
      }

      // Existing validation logic
      if (!username) errors.push('Username is required');
      else if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) errors.push('Username must be 3-20 characters and contain only letters, numbers, or underscores');

      if (!email) errors.push('Email is required');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Please enter a valid email address');
      else {
        const emailDomain = email.split('@')[1];
        if (disposableDomains.has(emailDomain)) errors.push('Temporary or disposable email addresses are not allowed');
        try {
          const emailRepResponse = await axios.get(`https://emailrep.io/${email}`);
          if (emailRepResponse.data.suspicious || emailRepResponse.data.disposable) errors.push('This email address is flagged as suspicious or temporary');
        } catch (repErr) {
          console.error('Email reputation check failed:', repErr);
        }
      }

      if (!phone) errors.push('Phone number is required');
      else if (!/^\+?[1-9]\d{1,14}$/.test(phone)) errors.push('Please enter a valid phone number');

      if (!password) errors.push('Password is required');
      else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])(?!.*\s).{8,}$/.test(password)) errors.push('Password must be at least 8 characters, contain uppercase, lowercase, number, special character, and no spaces');

      if (!confirmPassword) errors.push('Confirm password is required');
      else if (password !== confirmPassword) errors.push('Passwords do not match');

      const validPlans = ['Basic', 'Standard-Monthly', 'Standard-Yearly', 'Pro-Monthly', 'Pro-Yearly', 'Advanced-Monthly', 'Advanced-Yearly', 'Enterprise-Monthly', 'Enterprise-Yearly', 'Premium'];
      if (!plan) errors.push('Plan selection is required');
      else if (!validPlans.includes(plan)) errors.push('Invalid plan selected');

      if (errors.length > 0) {
        req.flash('error', errors.join('. '));
        return res.render('signup', { error: errors.join('. '), username, email, phone, plan });
      }

      let billingPeriod = 'monthly';
      if (plan.includes('Yearly')) billingPeriod = 'yearly';

      const existingUser = await User.findOne({ 
        $or: [
          { email: email.toLowerCase() },
          { phone },
          { username },
          { signupIp: req.ip, signupTimestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        ]
      });
      if (existingUser) {
        req.flash('error', 'Email, phone, username, or IP address already registered recently.');
        return res.redirect('/signup');
      }

      const emailDomain = email.split('@')[1];
      try {
        const mxRecords = await dns.promises.resolveMx(emailDomain);
        if (!mxRecords || mxRecords.length === 0) {
          req.flash('error', 'Email domain does not have valid mail servers.');
          return res.redirect('/signup');
        }
      } catch (dnsErr) {
        if (dnsErr.code === 'ENOTFOUND' || dnsErr.code === 'ENODATA') {
          req.flash('error', 'Email domain does not exist or has no mail servers.');
          return res.redirect('/signup');
        }
        throw dnsErr;
      }

      const tenantsLimit = getTenantsCount(plan);
      const planAmount = planRates[plan] || 0;

      const user = new User({
        username,
        email: email.toLowerCase(),
        phone,
        password,
        plan,
        tenantsLimit,
        isVerified: false,
        verificationToken: crypto.randomBytes(32).toString('hex'),
        paymentStatus: {
          transactionId: null,
          amount: planAmount,
          status: 'pending',
          billingPeriod: billingPeriod 
        },
        signupIp: req.ip,
        signupTimestamp: new Date(),
        failedAttempts: 0,
        lastSignupAttempt: new Date()
      });

      await User.register(user, password)
        .then(async () => {
          try {
            await sendWelcomeEmail(email, username, user.verificationToken);
            await sendWelcomeSMS(phone, username);
            req.flash('success', 'Successfully signed up! Please check your email or spam to verify your account.');
            res.redirect('/login');
          } catch (emailErr) {
            console.error('Email sending failed:', emailErr);
            req.flash('success', 'Successfully signed up! Verification email failed to send, please contact support.');
            res.redirect('/login');
          }
        })
        .catch(err => {
          throw new Error('Registration failed: ' + err.message);
        });

    } catch (err) {
      console.error('Signup error:', err);
      req.flash('error', 'An unexpected error occurred. Please try again.');
      res.redirect('/signup');
    }
  });

// List of disposable email domains 
const disposableDomains = new Set([
  'mailinator.com',
  'tempmail.com',
  'guerrillamail.com',
  '10minutemail.com'
]);

// Google OAuth Routes
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

// Redirect to Facebook
router.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));

// Facebook callback
router.get('/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful login
    res.redirect('/dashboard');
  });


router.get('/tenancyManager/dashboard', 
  passport.authenticate('google', {
    failureRedirect: '/login', 
  }),
  (req, res) => {
    res.redirect('/verification');
});

// Signup route
router.get('/signup', (req, res) => {
  const error = req.flash('error');
  res.render('tenancyManager/signup', { errors: { error: error.length > 0 ? error[0] : null } });
});


const planRates = {
  'Basic': 0,
  'Standard-Monthly': 1499,
  'Standard-Yearly': 14390,
  'Pro-Monthly': 2999,
  'Pro-Yearly': 28790,
  'Advanced-Monthly': 4499,
  'Advanced-Yearly': 43190,
  'Enterprise-Monthly': 6999,
  'Enterprise-Yearly': 67190,
  'Premium': null
};

function getTenantsCount(plan) {
  const tenantsLimit = {
    'Basic': 5,
    'Standard-Monthly': 20,
    'Standard-Yearly': 20,
    'Pro-Monthly': 50,
    'Pro-Yearly': 50,
    'Advanced-Monthly': 100,
    'Advanced-Yearly': 100,
    'Enterprise-Monthly': 150,
    'Enterprise-Yearly': 150,
    'Premium': Infinity
  };
  return tenantsLimit[plan] || 5;
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'vickinstechnologies@gmail.com',
    pass: 'vnueayfgjstaazxh'       
  }
});

const sendWelcomeEmail = async (email, username, verificationToken) => {
  const mailOptions = {
      from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`, 
      to: email,
      subject: 'Welcome to Lease Captain! Please Verify Your Email',
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Lease Captain!</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
            color: #333;
        }
        .container {
            width: 100%;
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }
        .header {
            background-color: #003366;
            padding: 20px;
            text-align: center;
            color: white;
            border-radius: 8px 8px 0 0;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 20px;
            line-height: 1.6;
        }
        .content p {
            margin: 10px 0;
        }
        .cta-button {
            display: inline-block;
            padding: 12px 20px;
            background-color: #003366;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
            text-align: center;
            transition: background-color 0.3s;
        }
        .cta-button:hover {
            background-color: #00509E;
        }
        .footer {
            text-align: center;
            color: #777;
            font-size: 12px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to Lease Captain!</h1>
        </div>
        <div class="content">
            <p>Greetings <strong>${username}</strong>,</p>
            <p>Thank you for signing up! We are thrilled to have you on board.</p>
            <p>To complete your registration, please verify your email address by clicking the link below:</p>
            <p><a href="https://leasecaptain.com/verify/${verificationToken}" class="cta-button">Verify Email</a></p>
            <p>If you did not sign up for this account, you can ignore this email.</p>
            <p>Best regards,<br>Lease Captain Team</p>
        </div>
        <div class="footer">
            &copy; 2024 Lease Captain. All rights reserved.
        </div>
    </div>
</body>
</html>
    `
  };

  try {
      await transporter.sendMail(mailOptions);
      console.log('Welcome email sent successfully.');
  } catch (error) {
      console.error('Error sending welcome email:', error);
  }
};

// Send welcome SMS using UMS API
const sendWelcomeSMS = async (phone, username) => {
  const message = `Greetings ${username}, welcome to Lease Captain! We're excited to support your property management journey. Enjoy a seamless and efficient experience with us!`;


  try {
    const response = await axios.post(
      'https://api.umeskiasoftwares.com/api/v1/sms',
      
      {
        api_key: process.env.SMS_API_KEY,
        email: process.env.SMS_EMAIL,
        Sender_Id: process.env.SMS_SENDER_ID,
        message: message,
        phone: phone
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('Welcome SMS sent successfully via UMS API:', response.data);
  } catch (error) {
    console.error('Error sending SMS via UMS API:', error.response ? error.response.data : error.message);
  }
};

// Login route
router.get('/login', (req, res) => {
  const error = req.flash('error');
  res.render('tenancyManager/login', { errors: { error: error.length > 0 ? error[0] : null } });
});

router.post('/login', (req, res, next) => {
  const { email, password } = req.body; 
  // Rate limiting to prevent brute force using session
  const loginKey = `login_attempts_${req.ip}`;
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_TIME = 15 * 60 * 1000;

  // Initialize session attempts if not present
  if (!req.session[loginKey]) {
    req.session[loginKey] = {
      attempts: 0,
      lockoutUntil: null
    };
  }

  const sessionData = req.session[loginKey];

  // Check if user is locked out
  if (sessionData.lockoutUntil && Date.now() < sessionData.lockoutUntil) {
    const minutesLeft = Math.ceil((sessionData.lockoutUntil - Date.now()) / 60000);
    req.flash('error', `Too many login attempts. Please try again in ${minutesLeft} minute(s).`);
    return res.redirect('/login');
  }

  // Reset attempts if lockout period has expired
  if (sessionData.lockoutUntil && Date.now() >= sessionData.lockoutUntil) {
    sessionData.attempts = 0;
    sessionData.lockoutUntil = null;
  }

  // Check attempt limit before authentication
  if (sessionData.attempts >= MAX_ATTEMPTS) {
    sessionData.lockoutUntil = Date.now() + LOCKOUT_TIME;
    req.flash('error', 'Too many login attempts. Please try again in 15 minutes.');
    return res.redirect('/login');
  }

  // Authenticate using passport-local-mongoose
  passport.authenticate('local', { session: true }, async (err, user, info) => {
    if (err) {
      console.error('Authentication error:', err);
      req.flash('error', 'An unexpected error occurred during login.');
      return res.redirect('/login');
    }

    if (!user) {
      // Increment attempts on failure
      sessionData.attempts += 1;
      req.flash('error', info ? info.message : 'Invalid login credentials.');
      return res.redirect('/login');
    }

    // Check if user is verified
    if (!user.isVerified) {
      req.flash('error', 'Please verify your email before logging in.');
      return res.redirect('/login');
    }

    // Successful login
    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error('Login error:', loginErr);
        req.flash('error', 'Failed to log you in. Please try again.');
        return res.redirect('/login');
      }

      try {
        // Record login activity
        const device = req.headers['user-agent'] || 'Unknown device';
        user.loginActivity.push({
          loginTime: new Date(),
          ipAddress: req.ip,
          device: device
        });

        // Reset new user flag and attempts on successful login
        user.isNewUser = false;
        sessionData.attempts = 0;
        sessionData.lockoutUntil = null;

        await user.save();
        return res.redirect('/dashboard');
      } catch (saveErr) {
        console.error('Error saving login activity:', saveErr);
        req.flash('error', 'Login successful, but an error occurred. Contact support.');
        return res.redirect('/dashboard');
      }
    });
  })(req, res, next);
});

// Authentication middleware
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
      return next();
  }
  res.redirect('/login');
};

// Logout route
router.get('/logout', ensureAuthenticated, (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.flash('success', 'You have logged out.');
    res.redirect('/login');
  });
});

module.exports = router;
