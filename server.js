const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('./config/passport');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const User = require('./models/user');
const Payment = require('./models/payment');
const tenancyManagerRoutes = require('./routes/tenancyManager');
const propertyRoutes = require('./routes/properties');
const tenantRoutes = require('./routes/tenant');
const tenantPortalRoutes = require('./routes/tenantPortal');
const authRoutes = require('./routes/auth');
const paymentGatewayRoutes = require('./routes/paymentGateway');
const sendRemindersRoutes = require('./routes/sendReminders');
const fs = require('fs');
const os = require('os');
const https = require('https');
require('dotenv').config();
const cron = require('node-cron');
const app = express();

// Load SSL certificate
const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/leasecaptain.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/leasecaptain.com/fullchain.pem')
};

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/Rental-management')
    .then(() => console.log('===MongoDB connected successfully!==='))
    .catch(err => console.error('Database connection error:', err));

// View engine setup
app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 
app.use(methodOverride('_method'));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production'  
    }
}));

app.use(flash());

// Flash messages and user session handling
app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.tenantId = req.session.tenantId;  
    next();
});

// Passport.js setup
app.use(passport.initialize());
app.use(passport.session());

passport.use(User.createStrategy());
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Route setup
app.use('/', authRoutes);
app.use('/', tenancyManagerRoutes);
app.use('/', propertyRoutes);
app.use('/', tenantRoutes);
app.use('/', tenantPortalRoutes);
app.use('/', paymentGatewayRoutes);
app.use('/', sendRemindersRoutes);

// Landing page
app.get('/', (req, res) => {
    res.render('landingPage');
});

// 404 Error handling
app.use((req, res) => {
    res.status(404).render('404');
});

// 500 Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('500');
});

app.post('/callback', async (req, res) => {
  const stkCallbackResponse = req.body;
  const logFile = 'UmsPayMpesastkresponse.json';

  // Log the callback response to a file
  fs.appendFile(logFile, JSON.stringify(stkCallbackResponse, null, 2), (err) => {
      if (err) {
          console.error('Error writing to log file:', err.message);
          return res.status(500).json({ status: 'error', message: 'Could not write to log file' });
      }
      console.log('Callback data received and logged:', stkCallbackResponse);
  });

  // Extract the transactionId and ResultCode 
  const { transactionId, ResultCode, status } = stkCallbackResponse;

  try {
      // Update the payment based on the transaction ID and callback response
      if (transactionId && (ResultCode !== undefined || status)) {
          let updatedStatus;

          // Map ResultCode or status to payment status
          if (ResultCode === '0' || status === 'Success') {
              updatedStatus = 'completed';
          } else if (ResultCode !== '0' || status === 'Failed') {
              updatedStatus = 'failed';
          } else {
              updatedStatus = 'pending';
          }

          // Find and update the payment record
          const payment = await Payment.findOneAndUpdate(
              { transactionId },
              { status: updatedStatus },
              { new: true }
          );

          if (payment) {
              console.log(`Payment status updated for transaction ID ${transactionId}:`, updatedStatus);
              res.status(200).json({ status: 'success', message: 'Payment status updated' });
          } else {
              console.log(`Payment not found for transaction ID: ${transactionId}`);
              res.status(404).json({ status: 'error', message: 'Payment not found' });
          }
      } else {
          res.status(400).json({ status: 'error', message: 'Invalid callback data' });
      }
  } catch (error) {
      console.error('Error processing callback data:', error.message);
      res.status(500).json({ status: 'error', message: 'Error processing callback data' });
  }
});

// Get local IP address for server
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

// Start the server
const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

const server = https.createServer(options, app);

server.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log(`Server is running on https://${localIP}:${PORT}`);
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    server.close(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.close(() => process.exit(1));
});
