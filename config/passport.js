const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/user'); // Adjust the path as necessary
const bcrypt = require('bcrypt');

// Configure the local strategy for username/password authentication
passport.use('user-local', new LocalStrategy(
  {
    usernameField: 'username', // Use the username field from the login form
    passwordField: 'password' // Use the password field from the login form
  },
  async (username, password, done) => {
    try {
      // Find the user by username
      const user = await User.findOne({ username });
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      // Check the password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect password.' });
      }

      // Successful authentication
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

// Serialize user to save in session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user); // Attach the user object to the session
  } catch (error) {
    done(error);
  }
});

// Export the passport configuration
module.exports = passport;
