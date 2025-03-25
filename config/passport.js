const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/user');

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: '293701662889-4sb5fc2ld4ljdpvpgu7f2ep9v6kalakg.apps.googleusercontent.com',
    clientSecret: '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',
    callbackURL: 'https://leasecaptain.com/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      if (!user) {
        user = await User.findOne({ email: profile.emails[0].value });
        if (!user) {
          user = new User({
            googleId: profile.id,
            username: profile.displayName.replace(/\s+/g, '').toLowerCase(),
            email: profile.emails[0].value,
            plan: 'Basic', // Default plan for Google users
            phone: '',     // Required field, set a default or handle in UI
            password: undefined // No password for OAuth users
          });
          await user.save();
        } else {
          user.googleId = profile.id;
          await user.save();
        }
      }
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
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;