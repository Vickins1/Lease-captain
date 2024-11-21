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
const SupportMessage = require('./models/supportMessage');
const nodemailer = require('nodemailer');
const fs = require('fs');
const os = require('os');
require('dotenv').config();
const app = express();
const http = require('http');
const server = http.createServer(app);
app.set('trust proxy', 1);

const uri = "mongodb://Admin:Kefini360@lease-captain-shard-00-00.ryokh.mongodb.net:27017,lease-captain-shard-00-01.ryokh.mongodb.net:27017,lease-captain-shard-00-02.ryokh.mongodb.net:27017/?ssl=true&replicaSet=atlas-67tjyi-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Lease-Captain";

async function createDatabaseAndCollections() {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB Atlas!");

    const modelNames = mongoose.modelNames();

    if (modelNames.length === 0) {
      console.log("No models found! Ensure you have registered Mongoose models.");
      return;
    }

    const db = mongoose.connection.db;

    for (const modelName of modelNames) {
      const model = mongoose.model(modelName);

      const collectionName = model.collection.collectionName;
      const existingCollections = await db.listCollections({ name: collectionName }).toArray();

      if (existingCollections.length > 0) {
        console.log(`Collection for model '${modelName}' already exists.`);
      } else {
        await model.init();
        console.log(`Collection for model '${modelName}' created.`);
      }
    }

    console.log("Database and collections checked successfully!");
  } catch (error) {
    console.error("Error creating database and collections:", error);
  }
}

createDatabaseAndCollections().catch(console.dir);

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

// Route to render support page
app.get('/support', (req, res) => {
    const successMessage = req.flash('success') || null;
    const errorMessage = req.flash('error') || null;

    res.render('support', { successMessage, errorMessage });
});


// Configure Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
});

// POST endpoint to handle support form submission
app.post('/support/submit', async (req, res) => {
    const { emailAddress, supportMessage } = req.body;

    // Basic validation
    if (!emailAddress || !supportMessage) {
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect('/support');
    }
    // Email format validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(emailAddress)) {
        req.flash('error', 'Please enter a valid email address.');
        return res.redirect('/support');
    }

    try {
        // Save the support message to the database
        const newMessage = new SupportMessage({
            email: emailAddress,
            message: supportMessage,
            submittedAt: new Date()
        });

        // Attempt to save the new support message
        await newMessage.save();

        // Set up email options
        const mailOptions = {
            from: 'vickinstechnologies@gmail.com',
            to: 'vickievokes360@gmail.com',
            subject: 'New Support Message',
            text: `You have received a new support message from ${emailAddress}:\n\n${supportMessage}`
        };
        // Send email
        await transporter.sendMail(mailOptions);
        // Set success message after successful email sending
        req.flash('success', 'Your message has been sent successfully, Our support team will be back to you ASAP!');
        return res.redirect('/support'); // Redirect to support page
    } catch (error) {
        console.error('Error processing support request:', error);

        // Set error message based on specific error type
        if (error instanceof mongoose.Error.ValidationError) {
            req.flash('error', 'Validation failed: ' + error.message);
        } else if (error.name === 'MongoError') {
            req.flash('error', 'Failed to save your message due to a database error. Please try again later.');
        } else if (error.responseCode) {
            req.flash('error', 'Failed to send your message via email. Please try again later.');
        } else {
            req.flash('error', 'An unexpected error occurred. Please try again later.');
        }

        return res.redirect('/support');
    }
});

app.get('/verify/:token', async (req, res) => {
    const { token } = req.params;

    try {
        // Find user with the given token
        const user = await User.findOne({ verificationToken: token });

        if (!user) {
            req.flash('error', 'Invalid or expired verification token.');
            return res.redirect('/login');
        }

        // Update user verification status
        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        req.flash('success', 'Email verified successfully! You can now log in.');
        res.redirect('/login');
    } catch (error) {
        console.error('Error during email verification:', error);
        req.flash('error', 'Error verifying your email. Please try again.');
        res.redirect('/login');
    }
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
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
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

