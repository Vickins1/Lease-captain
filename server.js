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
const cron = require('node-cron');
const fs = require('fs');
const os = require('os');
require('dotenv').config();
const app = express();
const http = require('http');
const server = http.createServer(app);
app.set('trust proxy', 1);

const uri = "mongodb://localhost:27017/LC-db";


async function createDatabaseAndCollections() {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB!");

        const modelNames = mongoose.modelNames();

        if (modelNames.length === 0) {
            return;
        }

        const db = mongoose.connection.db;

        for (const modelName of modelNames) {
            const model = mongoose.model(modelName);

            const collectionName = model.collection.collectionName;
            const existingCollections = await db.listCollections({ name: collectionName }).toArray();

            if (existingCollections.length > 0) {
            } else {
                await model.init();
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
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production'
    }
}));

app.use(flash());

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

// Utility function to check reminder days
const isReminderDay = (paymentDay, daysBefore) => {
    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth(), paymentDay - daysBefore);
  
    // Adjust for previous month overflow
    if (targetDate.getMonth() < today.getMonth() || targetDate.getFullYear() < today.getFullYear()) {
      targetDate.setMonth(today.getMonth() - 1);
      targetDate.setFullYear(today.getFullYear());
    }
  
    return today.getDate() === targetDate.getDate() && today.getMonth() === targetDate.getMonth();
  };
  

  // Email logic function
  const sendReminderEmail = async (recipientEmail, tenantName, reminderType, dueType = 'Rent, Utility', amountDue = 0) => {
    let subject = '';
    let message = '';

    const tenant = await Tenant.findOne({ email: recipientEmail }).populate('owner');
    const ownerEmail = tenant?.owner?.email || 'defaultowneremail@domain.com';
  
    switch (reminderType) {
      case '10_days':
        subject = `${dueType} Payment Reminder: Upcoming Deadline in 10 Days`;
        message = `
          Dear ${tenantName},<br><br>
          We hope this message finds you well. We are writing to remind you that your upcoming ${dueType.toLowerCase()} payment of <strong>$${amountDue.toFixed(2)}</strong> is due in 10 days.<br><br>
          To avoid any inconvenience or penalties, we kindly ask that you complete the payment via your Tenant Portal by the due date. Your prompt attention to this matter is greatly appreciated.<br><br>
          If you have already scheduled this payment, please disregard this message.<br><br>
          For easy and secure payment processing, you can access your Tenant Portal directly through the link below:<br><br>
          <a href="https://leasecaptain.com/tenantPortal/login" style="color: #003366;">Complete Payment Now</a><br><br>
          Best regards,<br>
          The Management Team
        `;
        break;
  
      case '5_days':
        subject = `${dueType} Payment Reminder: Deadline Approaching in 5 Days`;
        message = `
          Dear ${tenantName},<br><br>
          This is a reminder that your ${dueType.toLowerCase()} payment of <strong>$${amountDue.toFixed(2)}</strong> is due in 5 days. Please ensure the payment is made on time by completing the process through your Tenant Portal.<br><br>
          If you have any questions or need assistance, feel free to reach out to us. Your cooperation in ensuring timely payments is greatly valued.<br><br>
          You can conveniently complete the payment by logging into your Tenant Portal using the link below:<br><br>
          <a href="https://leasecaptain.com/tenantPortal/login" style="color: #003366;">Complete Payment Now</a><br><br>
          Thank you for your attention to this matter.<br><br>
          Warm regards,<br>
          The Management Team
        `;
        break;
  
      case 'due_today':
        subject = `${dueType} Payment Due: Immediate Attention Required`;
        message = `
          Dear ${tenantName},<br><br>
          We wish to remind you that your ${dueType.toLowerCase()} payment of <strong>$${amountDue.toFixed(2)}</strong> is due today. Please ensure that the payment is completed via your Tenant Portal to avoid any late fees or service disruptions.<br><br>
          If you have already processed this payment, we thank you for your diligence. Should you require any assistance or have any questions, please do not hesitate to contact us.<br><br>
          You can access your Tenant Portal and complete the payment by clicking the link below:<br><br>
          <a href="https://leasecaptain.com/tenantPortal/login" style="color: #003366;">Complete Payment Now</a><br><br>
          Thank you for your prompt attention.<br><br>
          Sincerely,<br>
          The Management Team
        `;
        break;
  
      default:
        console.error('Invalid reminder type.');
        return;
    }
  
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f4f4f4;
              margin: 0;
              padding: 0;
            }
            .email-container {
              background-color: white;
              margin: 0 auto;
              padding: 20px;
              border-radius: 8px;
              max-width: 600px;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
              color: #333;
            }
            .header {
              background-color: #003366;
              color: white;
              padding: 15px;
              border-radius: 8px 8px 0 0;
              text-align: center;
            }
            .header h1 {
              font-size: 18px;
              margin: 0;
            }
            .content {
              padding: 20px;
              font-size: 14px;
              line-height: 1.6;
            }
            .footer {
              font-size: 12px;
              color: #555;
              text-align: center;
              padding: 15px 0;
            }
            .footer a {
              color: #003366;
              text-decoration: none;
            }
            .cta {
              display: inline-block;
              margin-top: 20px;
              padding: 10px 15px;
              background-color: #003366;
              color: white;
              text-decoration: none;
              border-radius: 4px;
            }
            .cta:hover {
              background-color: #00509e;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h1>${dueType} Payment Reminder</h1>
            </div>
            <div class="content">
              <p>Hi ${tenantName},</p>
              <p>${message}</p>
              <p>If you have already made the payment, please disregard this reminder.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Lease Captain. All rights reserved.</p>
              <p>
                <a href="https://leasecaptain.com">Visit our website</a> | 
                 <a href="mailto:${ownerEmail}">Contact Management</a>
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipientEmail,
      subject,
      html: htmlTemplate,
    };
  
    // Create transporter for email sending (if not already defined)
    const transporter = nodemailer.createTransport({
      service: 'gmail', // Or another email service you're using
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${recipientEmail}: ${subject}`);
    } catch (error) {
      console.error(`Error sending email to ${recipientEmail}:`, error);
    }
  };
  
  // Cron job to send reminders
  cron.schedule('0 9 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running rent and utility reminder cron job...`);
  
    try {
      const tenants = await Tenant.find().populate('property');
  
      const reminderPromises = tenants.map(async (tenant) => {
        const { name, email, rentDue, utilityDue, property } = tenant;
  
        if (property && property.paymentDay) {
          const { paymentDay } = property;
  
          // Rent reminders
          if (rentDue > 0) {
            if (isReminderDay(paymentDay, 10)) {
              await sendReminderEmail(email, name, '10_days', 10, 'Rent', rentDue);
            } else if (isReminderDay(paymentDay, 5)) {
              await sendReminderEmail(email, name, '5_days', 5, 'Rent', rentDue);
            } else if (isReminderDay(paymentDay, 0)) {
              await sendReminderEmail(email, name, 'due_today', 0, 'Rent', rentDue);
            }
          }
  
          // Utility reminders
          if (utilityDue > 0) {
            if (isReminderDay(paymentDay, 10)) {
              await sendReminderEmail(email, name, '10_days', 10, 'Utility', utilityDue);
            } else if (isReminderDay(paymentDay, 5)) {
              await sendReminderEmail(email, name, '5_days', 5, 'Utility', utilityDue);
            } else if (isReminderDay(paymentDay, 0)) {
              await sendReminderEmail(email, name, 'due_today', 0, 'Utility', utilityDue);
            }
          }
        }
      });
  
      await Promise.all(reminderPromises);
      console.log(`[${new Date().toISOString()}] Reminder emails successfully processed.`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during rent and utility reminders:`, error);
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

