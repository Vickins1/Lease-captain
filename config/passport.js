const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const User = require('../models/user');
require('dotenv').config();

// GOOGLE STRATEGY
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
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
            plan: 'Basic',
            phone: '',
            password: undefined
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

// FACEBOOK STRATEGY
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: process.env.FACEBOOK_CALLBACK_URL,
  profileFields: ['id', 'displayName', 'emails'] 
},
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || `${profile.id}@facebook.com`; // fallback
      let user = await User.findOne({ facebookId: profile.id });
      if (!user) {
        user = await User.findOne({ email });
        if (!user) {
          user = new User({
            facebookId: profile.id,
            username: profile.displayName.replace(/\s+/g, '').toLowerCase(),
            email: email,
            plan: 'Basic',
            phone: '',
            password: undefined
          });
          await user.save();
        } else {
          user.facebookId = profile.id;
          await user.save();
        }
      }
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

// SESSION SETUP
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
