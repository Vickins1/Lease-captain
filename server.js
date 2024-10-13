const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('./config/passport');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const User = require('./models/user'); 
const Tenant = require('./models/tenant'); 
const tenancyManagerRoutes = require('./routes/tenancyManager');
const propertyRoutes = require('./routes/properties');
const TenantRoutes = require('./routes/tenant');
const tenantPortalRoutes = require('./routes/tenantPortal');
const authRoutes = require('./routes/auth');
const app = express();
require('dotenv').config();

// Database Connection
mongoose.connect('mongodb://localhost:27017/Rental-management')
  .then(() => console.log('MongoDB connected successfully!'))
  .catch(err => console.error('Database connection error:', err));

// Middleware Setup
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static('public'));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));
app.use(flash());

// Make flash messages and current user available in views
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentUser = req.user; 
  next();
});

// Passport Configuration
app.use(passport.initialize());
app.use(passport.session());

passport.use(User.createStrategy());
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

// Routes
app.use('/', authRoutes);
app.use('/', tenancyManagerRoutes);
app.use('/', propertyRoutes);
app.use('/', TenantRoutes);
app.use('/', tenantPortalRoutes);

app.get('/', (req, res) => {
  res.render('landingPage'); 
});

// Handle 404 - Page Not Found
app.use((req, res, next) => {
  res.status(404);
  res.render('404');
});

// Handle 500 - Internal Server Error
app.use((err, req, res, next) => {
  console.error(err.stack); 
  res.status(500);
  res.render('500');
});

const os = require('os'); 

// Start Server
const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

// Function to get local network IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost'; 
}

// Start the server with error handling
const server = app.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  console.log(`Server is running on http://${localIP}:${PORT}`);
});

// Graceful shutdown on unhandled exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  server.close(() => {
    process.exit(1); 
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  server.close(() => {
    process.exit(1); 
  });
});
