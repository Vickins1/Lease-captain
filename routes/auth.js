const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/user');
const { isAuthenticated } = require('../middleware'); 

// Signup route
router.get('/signup', (req, res) => {
  const error = req.flash('error');
  res.render('tenancyManager/signup', { errors: { error: error.length > 0 ? error[0] : null } });
});

// Handle signup form submission
router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  // Input validation
  if (!username || !email || !password) {
    req.flash('error', 'All fields are required. Please fill in all fields.');
    return res.redirect('/signup');
  }

  try {
    const user = new User({ username, email });
    await User.register(user, password);
    req.flash('success', 'Successfully signed up! Please log in.');
    res.redirect('/login');
  } catch (err) {
    
    let errorMessage;
    if (err.code === 11000) { 
      errorMessage = 'Username or email already exists. Please choose another.';
    } else {
      errorMessage = 'Sign up failed: ' + err.message; 
    }
    
    console.log(err.message); 
    req.flash('error', errorMessage); 
    res.redirect('/signup');
  }
});


// Login route
router.get('/login', (req, res) => {
  const error = req.flash('error');
  res.render('tenancyManager/login', { errors: { error: error.length > 0 ? error[0] : null } });
});

// Handle login form submission
router.post('/login', (req, res, next) => {
  passport.authenticate('local', {
    successRedirect: '/tenancy-manager/dashboard',
    failureRedirect: '/login',
    failureFlash: true, 
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
