const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/user');
const { isAuthenticated } = require('../middleware');
const useragent = require('useragent');
const axios = require('axios');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Google OAuth Routes
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));


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

      const tenantsLimit = getTenantsCount(plan);

      // Create a new user object with necessary fields except password
      const user = new User({
          username,
          email,
          phone,
          password,
          plan,
          tenantsLimit,
          isVerified: false,
          verificationToken: crypto.randomBytes(32).toString('hex'), // Generate the verification token
      });

      // Register user with passport-local-mongoose to handle password hashing
      await User.register(user, password) // Pass the password here
          .then(async () => {
              // Send welcome email with verification link
              await sendWelcomeEmail(email, username, user.verificationToken); // Pass token to the email function

              req.flash('success', 'Successfully signed up! Please check your email to verify your account and log in.');
              res.redirect('/login');
          })
          .catch(err => {
              // Handle error during registration
              req.flash('error', 'Sign up failed: ' + err.message);
              res.redirect('/signup');
          });
  } catch (err) {
      let errorMessage;

      // Handle duplicate key error
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
          return 5;
      case 'Standard':
          return 20;
      case 'Pro':      
          return 50;
      case 'Advanced':
          return 100;
      case 'Enterprise': 
          return 150;
      case 'Premium':   
          return Infinity; 
      default:
          return 5;
  }
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
      // Customize the from field with a name
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
