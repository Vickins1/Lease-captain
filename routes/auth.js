const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/user');
const { isAuthenticated } = require('../middleware');
const useragent = require('useragent');
const bcrypt = require('bcrypt');
const axios = require('axios');
const nodemailer = require('nodemailer');

// Signup route
router.get('/signup', (req, res) => {
  const error = req.flash('error');
  res.render('tenancyManager/signup', { errors: { error: error.length > 0 ? error[0] : null } });
});

// Handle signup form submission
router.post('/signup', async (req, res) => {
  const { username, email, password, phone, plan } = req.body;

  // Input validation
  if (!username || !email || !password || !phone || !plan) {
    req.flash('error', 'All fields are required. Please fill in all fields.');
    return res.redirect('/signup');
  }

  try {
    // Check if the user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      req.flash('error', 'Email or phone number already exists. Please choose another.');
      return res.redirect('/signup');
    }

    // Set tenant limit based on the plan
    const tenantsLimit = getTenantsCount(plan);

    // Create a new user with the provided details
    const user = new User({
      username,
      email,
      phone,
      plan,
      tenantsLimit,
    });

    // Register user with passport-local-mongoose to handle password hashing
    await User.register(user, password);

    // Send welcome email and SMS
    await sendWelcomeEmail(email, username);
    await sendWelcomeSMS(phone, username);

    req.flash('success', 'Successfully signed up! Please log in.');
    res.redirect('/login');
  } catch (err) {
    let errorMessage;

    if (err.code === 11000) {
      errorMessage = 'Username, email, or phone number already exists. Please choose another.';
    } else {
      errorMessage = 'Sign up failed: ' + err.message;
    }

    console.log('Error during signup:', err.message);
    req.flash('error', errorMessage);
    res.redirect('/signup');
  }
});


// Function to get tenants limit based on the selected plan
function getTenantsCount(plan) {
  switch (plan) {
    case 'Basic':
      return 10;
    case 'Standard':
      return 20;
    case 'Pro':
      return 50;
    case 'Advanced':
      return 100;
    case 'Premium':
      return 100; 
    default:
      return 10;
  }
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'vickinstechnologies@gmail.com',
    pass: 'vnueayfgjstaazxh'       
  }
});

// Send welcome email
const sendWelcomeEmail = async (email, username) => {
  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: 'Welcome to Lease Captain!',
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
                  background-color: #ffffff;
                  color: #333;
                  margin: 0;
                  padding: 0;
              }
              .email-container {
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  border: 1px solid #e0e0e0;
                  border-radius: 5px;
                  overflow: hidden;
              }
              .email-header {
                  background-color: #003366;
                  color: #ffffff;
                  padding: 20px;
                  text-align: center;
                  font-size: 24px;
                  font-weight: bold;
              }
              .email-body {
                  padding: 20px;
              }
              .email-body h1 {
                  color: #003366;
                  font-size: 22px;
                  margin-top: 0;
              }
              .email-body p {
                  line-height: 1.6;
                  color: #333;
                  margin: 15px 0;
              }
              .email-footer {
                  background-color: #f4f4f4;
                  padding: 10px;
                  text-align: center;
                  color: #777;
                  font-size: 12px;
              }
          </style>
      </head>
      <body>
          <div class="email-container">
              <!-- Email Header -->
              <div class="email-header">
                  Welcome to Lease Captain!
              </div>
              
              <!-- Email Body -->
              <div class="email-body">
                  <h1>Greetings, ${username}!</h1>
                  <p>Welcome to <strong>Lease Captain</strong>! We’re thrilled to have you on board.</p>
                  <p>Thank you for choosing Lease Captain as your property management partner. We’re here to help you manage your properties effortlessly.</p>
                  <p>If you have any questions, feel free to reach out to our support team.</p>
                  <p>Best regards,<br>Lease Captain Team</p>
              </div>
              
              <!-- Email Footer -->
              <div class="email-footer">
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
        api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
        email: "vickinstechnologies@gmail.com",
        Sender_Id: "UMS_SMS",
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

// Handle login form submission
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error("Authentication error:", err); // Log detailed error
      return next(err); // Handle server errors
    }
    if (!user) {
      console.warn("Authentication failed: Invalid username or password");
      req.flash('error', 'Invalid username or password');
      return res.redirect('/login'); // Handle incorrect credentials
    }
    
    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error("Error during login session:", loginErr);
        return next(loginErr);
      }

      // Capture the login activity
      const agent = useragent.parse(req.headers['user-agent']);
      const loginActivity = {
        loginTime: new Date(),
        ipAddress: req.ip,
        device: agent.toString()
      };

      try {
        // Push the latest login activity and keep the last 5 entries
        await User.findByIdAndUpdate(user._id, {
          $push: { loginActivity: { $each: [loginActivity], $slice: -5 } }
        });

        console.log(`User ${user.username} logged in successfully at ${new Date()}`);
        return res.redirect('/tenancy-manager/dashboard'); // Redirect to dashboard on successful login
      } catch (error) {
        console.error('Error logging login activity:', error);
        req.flash('error', 'An error occurred during login. Please try again.');
        return res.redirect('/login');
      }
    });
  })(req, res, next);
});


// Logout route
router.get('/logout', isAuthenticated, (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.flash('success', 'You have logged out.');
    res.redirect('/login');
  });
});

module.exports = router;
