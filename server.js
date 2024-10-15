const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('./config/passport');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const User = require('./models/user');
const Tenant = require('./models/tenant');
const Payment = require('./models/payment'); 
const tenancyManagerRoutes = require('./routes/tenancyManager');
const propertyRoutes = require('./routes/properties');
const TenantRoutes = require('./routes/tenant');
const tenantPortalRoutes = require('./routes/tenantPortal');
const authRoutes = require('./routes/auth');
const paymentGatewayRoutes = require('./routes/paymentGateway');
const axios = require('axios');
const fs = require('fs');
const http = require('http'); 
const socketIO = require('socket.io'); 
const os = require('os');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server); 

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/Rental-management')
    .then(() => console.log('MongoDB connected successfully!'))
    .catch(err => console.error('Database connection error:', err));

// Set view engine
app.set('view engine', 'ejs');

// Middleware setup
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static('public'));
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));
app.use(flash());

// Local variables for flash messages and user
app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.currentUser = req.user;
    next();
});

// Passport initialization
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

// WebSocket setup to broadcast payment updates
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('fetchPayments', async () => {
        try {
            const payments = await Payment.find().sort({ datePaid: -1 }).limit(10);
            socket.emit('paymentUpdates', payments);
        } catch (error) {
            console.error('Error fetching payments:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Routes setup
app.use('/', authRoutes);
app.use('/', tenancyManagerRoutes);
app.use('/', propertyRoutes);
app.use('/', TenantRoutes);
app.use('/', tenantPortalRoutes);
app.use('/', paymentGatewayRoutes);

// Landing page
app.get('/', (req, res) => {
    res.render('landingPage');
});

// Error handling for 404
app.use((req, res) => {
    res.status(404).render('404');
});

// Error handling for 500
app.use((err, req, res) => {
    console.error(err.stack);
    res.status(500).render('500');
});

// Payment verification function
async function verifyPayment(api_key, email, transaction_request_id) {
    const payload = {
        api_key,
        email,
        transaction_request_id,
    };

    try {
        const response = await axios.post('https://api.umeskiasoftwares.com/api/v1/transactionstatus', payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data;
    } catch (error) {
        console.error('Error verifying payment:', error);
        return error.response ? error.response.data : { error: 'An error occurred' };
    }
}

// Callback route for payment updates
app.post('/callback', async (req, res) => {
  const stkCallbackResponse = req.body;
  const logFile = 'UmsPayMpesastkresponse.json';

  fs.appendFile(logFile, JSON.stringify(stkCallbackResponse, null, 2), (err) => {
      if (err) {
          console.error('Error writing to log file:', err);
          return res.status(500).json({ status: 'error', message: 'Could not write to log file' });
      }
      console.log('Callback data received:', stkCallbackResponse);
      io.emit('paymentCallback', stkCallbackResponse);

      // Extract necessary details from the callback response
      const { api_key, email, transaction_request_id } = stkCallbackResponse;

      // Verify payment
      verifyPayment(api_key, email, transaction_request_id)
          .then(async (verificationResponse) => {
              if (verificationResponse.status === 'success') {
                  const transactionId = verificationResponse.transactionId;

                  await Payment.updatePaymentStatus(transactionId); 
              }
          })
          .catch(error => {
              console.error('Payment verification failed:', error);
          });

      res.status(200).json({ status: 'success', message: 'Callback data received and logged' });
  });
});




// Get local IP address for the server
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

server.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log(`Server is running on http://${localIP}:${PORT}`);
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
