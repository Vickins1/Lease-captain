const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('./config/passport');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const User = require('./models/user');
const PropertyList = require('./models/propertyList');
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
const path = require('path');
app.set('trust proxy', 1);
const uri = "mongodb+srv://Admin:Kefini360@lease-captain.ryokh.mongodb.net/LC-db?retryWrites=true&w=majority&appName=Lease-Captain";

async function connectToDatabase() {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

connectToDatabase();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'Lease',
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

// GET: Landing Page with Search
app.get('/', async (req, res) => {
  try {
      const { propertyType, category, city, min_price, max_price, bedrooms, bathrooms } = req.query;
      let query = { status: 'available' };

      // Apply filters only if provided and valid
      if (propertyType && propertyType !== '') query.propertyType = propertyType;
      if (category && category !== '') query.category = category;
      if (city && city !== '') query.location = new RegExp(city, 'i'); // Case-insensitive search
      if (min_price && !isNaN(parseFloat(min_price))) {
          query.price = { ...query.price, $gte: parseFloat(min_price) };
      }
      if (max_price && !isNaN(parseFloat(max_price))) {
          query.price = { ...query.price, $lte: parseFloat(max_price) };
      }
      if (bedrooms && !isNaN(parseInt(bedrooms))) {
          query.bedrooms = parseInt(bedrooms);
      }
      if (bathrooms && !isNaN(parseInt(bathrooms))) {
          query.bathrooms = parseInt(bathrooms);
      }

      const properties = await PropertyList.find(query).lean();
      res.render('landingPage', { 
          properties, 
          query: req.query 
      });
  } catch (err) {
      console.error('Error fetching properties:', err);
      res.render('landingPage', { 
          properties: [], 
          query: req.query 
      });
  }
});

app.get('/properties', async (req, res) => {
  try {
      const properties = await PropertyList.find({ status: 'available' })
          .sort({ _id: -1 })
          .populate('owner', 'phone email');

      res.render('properties', { properties });
  } catch (err) {
      console.error('Error fetching properties:', err);
      res.status(500).send('Server Error');
  }
});

// Property Detail Route
app.get('/property/:id', async (req, res) => {
  try {
      const property = await PropertyList.findById(req.params.id)
          .populate('owner', 'phone email'); // Populate owner details (optional)
      if (!property) {
          return res.status(404).send('Property not found');
      }
      res.render('property-details', { property }); // Assuming a detail page exists
  } catch (err) {
      console.error('Error fetching property:', err);
      res.status(500).send('Server Error');
  }
});

// Landing page
app.get('/contacts', (req, res) => {
  const successMessage = req.flash('success') || null;
  const errorMessage = req.flash('error') || null;

  res.render('contacts', { successMessage, errorMessage });
});

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
});

// Support form submission
app.post('/support/submit', async (req, res) => {
  console.log('Form Data:', req.body);
  const { name, email, number, address, message, reviewcheck } = req.body;

  // Basic validation
  if (!name || !email || !number || !address || !message || !reviewcheck) {
    req.flash('error', 'Please fill in all required fields.');
    return res.redirect('/contacts');
  }

  // Email format validation
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    req.flash('error', 'Please enter a valid email address.');
    return res.redirect('/contacts');
  }

  // Phone number validation
  const numberPattern = /^[0-9]{7,15}$/;
  if (!numberPattern.test(number)) {
    req.flash('error', 'Please enter a valid phone number (7-15 digits).');
    return res.redirect('/contacts');
  }

  // Check if user agreed to data collection
  if (!reviewcheck) {
    req.flash('error', 'You must agree to the data collection policy.');
    return res.redirect('/contacts');
  }

  try {
    // Convert reviewcheck to a Boolean (if 'on' is checked, it becomes true)
    const isReviewChecked = reviewcheck === 'on';

    // Save the support message to the database
    const newMessage = new SupportMessage({
      name,
      email,
      number,
      address,
      message,
      reviewcheck: isReviewChecked,
      submittedAt: new Date(),
    });

    await newMessage.save();

// Set up email options
const mailOptions = {
  from: `"Lease Captain Support" <${process.env.EMAIL_USERNAME}>`,
  to: 'vickievokes360@gmail.com',
  subject: 'New Support Message',
  html: `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f5f7fa;
          margin: 0;
          padding: 0;
          color: #333;
        }
        .container {
          max-width: 600px;
          margin: 20px auto;
          background: #ffffff;
          border-radius: 10px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          border-top: 5px solid #003366;
        }
        .header {
          background: linear-gradient(90deg, #003366, #0066cc);
          padding: 20px;
          text-align: center;
          color: #ffffff;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
        }
        .content {
          padding: 20px;
        }
        .content h2 {
          color: #003366;
          font-size: 18px;
          margin-bottom: 15px;
        }
        .content p {
          font-size: 16px;
          line-height: 1.5;
          margin: 5px 0;
        }
        .field-label {
          font-weight: 600;
          color: #003366;
        }
        .footer {
          background: #f5f7fa;
          padding: 10px;
          text-align: center;
          font-size: 12px;
          color: #666;
        }
        .footer a {
          color: #003366;
          text-decoration: none;
        }
        .footer a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>New Support Message</h1>
        </div>
        <div class="content">
          <h2>You have received a new support message:</h2>
          <p><span class="field-label">Name:</span> ${name}</p>
          <p><span class="field-label">Email:</span> ${email}</p>
          <p><span class="field-label">Phone:</span> ${number}</p>
          <p><span class="field-label">Address:</span> ${address}</p>
          <p><span class="field-label">Message:</span> ${message}</p>
        </div>
        <div class="footer">
          <p>Sent from <a href="https://leasecaptain.com">Lease Captain</a> | Support Team</p>
        </div>
      </div>
    </body>
    </html>
  `,
};

    // Send email
    await transporter.sendMail(mailOptions);

    // Set success message
    req.flash('success', 'Your message has been sent successfully. Our support team will contact you as soon as possible.');
    return res.redirect('/contacts');
  } catch (error) {
    console.error('Error processing support request:', error);

    // Handle specific errors
    if (error instanceof mongoose.Error.ValidationError) {
      req.flash('error', `Validation error: ${error.message}`);
    } else if (error.name === 'MongoError') {
      req.flash('error', 'Database error. Please try again later.');
    } else if (error.responseCode) {
      req.flash('error', 'Email sending failed. Please try again later.');
    } else {
      req.flash('error', 'An unexpected error occurred. Please try again later.');
    }

    return res.redirect('/contacts');
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

app.use((req, res) => {
  res.status(404).render('404', { currentUser: req.user || null });
});

app.use((req, res) => {
  res.status(500).render('500', { currentUser: req.user || null });
});

// Tenancy Manager specific middleware
app.use('/tenancy-manager', (req, res, next) => {
  req.isTenancyManager = true; 
  next();
});

app.use((req, res, next) => {
  if (req.isTenancyManager) {
      return res.status(404).render('tenancyManager/404', { title: 'Page Not Found', currentUser: req.user || null });
  }
  next(); 
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

  const sendReminderEmail = async (recipientEmail, tenantName, reminderType, dueType = 'Rent', tenantId = null) => {
    try {
      // Fetch the tenant record
      const tenant = await Tenant.findOne({ email: recipientEmail }).populate('owner');
      if (!tenant) {
        console.error(`[${new Date().toISOString()}] Tenant not found for email: ${recipientEmail}`);
        return;
      }
  
      // Resolve amountDue based on dueType (Rent or Utility)
      let amountDue = 0;
      const currentMonth = new Date().getMonth(); // Get the current month (0 = January, 11 = December)
  
      if (dueType.toLowerCase() === 'rent') {
        // Get the rent due for the current month
        amountDue = tenant.rentDue || 0;
      } else if (dueType.toLowerCase() === 'utility') {
        // Get the utility due for the current month
        amountDue = tenant.utilityDue || 0;
  
        // Safely handle tenant.utilities being undefined or null
        if (Array.isArray(tenant.utilities)) {
          tenant.utilities.forEach((utility) => {
            if (utility.month === currentMonth) {
              amountDue += utility.amount; // Add the utility amount for the current month
            }
          });
        }
      } else {
        console.error(`[${new Date().toISOString()}] Invalid dueType: ${dueType}`);
        return;
      }
  
      // Tenant owner's email
      const ownerEmail = tenant.owner?.email || 'defaultowneremail@domain.com';
  
      // Define email subject and message
      let subject = '';
      let message = '';
  
      switch (reminderType) {
        case '10_days':
          subject = `${dueType} Payment Reminder: Upcoming Deadline in 10 Days`;
          message = `
            Dear ${tenantName},<br><br>
            This is a reminder that your ${dueType.toLowerCase()} payment of <strong>Ksh.${amountDue.toFixed(2)}</strong> is due in 10 days.<br><br>
            Please complete the payment through your Tenant Portal by the due date.<br><br>
            <a href="https://leasecaptain.com/tenantPortal/login" style="color: #003366;">Make Payment Now</a>
          `;
          break;
  
        case '5_days':
          subject = `${dueType} Payment Reminder: Deadline Approaching in 5 Days`;
          message = `
            Dear ${tenantName},<br><br>
            This is a reminder that your ${dueType.toLowerCase()} payment of <strong>Ksh.${amountDue.toFixed(2)}</strong> is due in 5 days.<br><br>
            Please log into your Tenant Portal to make the payment promptly.<br><br>
            <a href="https://leasecaptain.com/tenantPortal/login" style="color: #003366;">Pay Now</a>
          `;
          break;
  
        case 'due_today':
          subject = `${dueType} Payment Due: Immediate Attention Required`;
          message = `
            Dear ${tenantName},<br><br>
            Your ${dueType.toLowerCase()} payment of <strong>Ksh.${amountDue.toFixed(2)}</strong> is due today.<br><br>
            Please ensure the payment is completed to avoid late fees.<br><br>
            <a href="https://leasecaptain.com/tenantPortal/login" style="color: #003366;">Complete Payment</a>
          `;
          break;
  
        default:
          console.error(`[${new Date().toISOString()}] Invalid reminder type: ${reminderType}`);
          return;
      }
  
      // Email HTML template
      const htmlTemplate = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
              .email-container { background-color: white; margin: 20px auto; padding: 20px; border-radius: 8px; max-width: 600px; }
              .header { background-color: #003366; color: white; padding: 15px; text-align: center; }
              .content { font-size: 14px; line-height: 1.6; color: #333; }
              .footer { font-size: 12px; color: #555; text-align: center; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <h2>${dueType} Payment Reminder</h2>
              </div>
              <div class="content">
                ${message}
                <p>If you have already made the payment, kindly ignore this reminder.</p>
              </div>
              <div class="footer">
                <p>&copy; ${new Date().getFullYear()} Lease Captain. All rights reserved.</p>
                <p>
                  <a href="https://leasecaptain.com" style="color: #003366;">Visit our website</a> | 
                  <a href="mailto:${ownerEmail}" style="color: #003366;">Contact Management</a>
                </p>
              </div>
            </div>
          </body>
        </html>
      `;
  
      // Email options
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: recipientEmail,
        subject,
        html: htmlTemplate,
      };
  
      // Send email using Nodemailer
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
  
      await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${recipientEmail}: ${subject}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error sending email to ${recipientEmail}:`, error);
    }
  };

// Cron job to send reminders
cron.schedule('08 00 * * *', async () => {
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
            await sendReminderEmail(email, name, '10_days', 'Rent', parseFloat(rentDue));
          } else if (isReminderDay(paymentDay, 5)) {
            await sendReminderEmail(email, name, '5_days', 'Rent', parseFloat(rentDue));
          } else if (isReminderDay(paymentDay, 0)) {
            await sendReminderEmail(email, name, 'due_today', 'Rent', parseFloat(rentDue));
          }
        }

        // Utility reminders
        if (utilityDue > 0) {
          if (isReminderDay(paymentDay, 10)) {
            await sendReminderEmail(email, name, '10_days', 'Utility', parseFloat(utilityDue));
          } else if (isReminderDay(paymentDay, 5)) {
            await sendReminderEmail(email, name, '5_days', 'Utility', parseFloat(utilityDue));
          } else if (isReminderDay(paymentDay, 0)) {
            await sendReminderEmail(email, name, 'due_today', 'Utility', parseFloat(utilityDue));
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

