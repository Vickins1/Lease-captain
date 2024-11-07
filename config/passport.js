const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const User = require('../models/user'); // Adjust path to your User model

// Local Strategy for username/password authentication
passport.use('user-local', new LocalStrategy(
  {
    usernameField: 'username',
    passwordField: 'password'
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

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: '293701662889-4sb5fc2ld4ljdpvpgu7f2ep9v6kalakg.apps.googleusercontent.com',
    clientSecret: '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',  
    callbackURL: "https://leasecaptain.com/tenancy-manager/dashboard" 
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      if (!user) {
        user = new User({
          googleId: profile.id,
          username: profile.displayName,
          email: profile.emails[0].value, 
        });
        await user.save();
      }
      done(null, user);
    } catch (error) {
      done(error, null);
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
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
