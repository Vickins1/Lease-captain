const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
require('dotenv').config();
const Property = require('../models/property');
const Tenant = require('../models/tenant');
const { isTenancyManager } = require('../middleware');
const bcrypt = require('bcryptjs');
const Payment = require('../models/payment');
const User = require('../models/user');
const PropertyUnit = require('../models/unit');
const Invoice = require('../models/invoice')
const Expense = require('../models/expense');
const Role = require('../models/role');
const MaintenanceRequest = require('../models/maintenanceRequest');
const Account = require('../models/account');
const Topups = require('../models/topups');
const Reminder = require('../models/reminder');
const crypto = require('crypto');
const Permission = require('../models/permissions');
const axios = require('axios')
const SupportMessage = require('../models/supportMessage');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
});

// Route to render the verification page
router.get('/verification', (req, res) => {
    // Check if the user is logged in
    if (!req.user) {
        req.flash('error', 'You need to be logged in to access this page.');
        return res.redirect('/login'); // Redirect to login if not authenticated
    }

    // Check if the user is already verified
    if (req.user.isVerified) {
        return res.redirect('/tenancy-manager/dashboard');
    }

    // Render the verification page if the user is not verified
    res.render('verification', { user: req.user });
});

// Route to send verification email
router.get('/verify/:token', async (req, res) => {
    try {
        const user = await User.findOne({ verificationToken: req.params.token });
        if (!user) {
            req.flash('error', 'Invalid or expired verification token.');
            return res.redirect('/login');
        }

        // Verify the user
        user.isVerified = true;
        user.verificationToken = undefined; // Clear the verification token
        await user.save();

        req.flash('success', 'Your email has been verified! You can now log in.');
        res.redirect('/login');
    } catch (error) {
        console.error('Error during email verification:', error);
        req.flash('error', 'An error occurred during verification. Please try again.');
        res.redirect('/login');
    }
});

// Route to resend verification email
router.get('/resend-verification', async (req, res) => {
    // Check if the user is logged in
    if (!req.user) {
        req.flash('error', 'You need to be logged in to resend the verification email.');
        return res.redirect('/login');
    }

    try {
        // Generate a new verification token
        const token = crypto.randomBytes(32).toString('hex');
        req.user.verificationToken = token;
        req.user.verificationExpires = Date.now() + 3600000;
        await req.user.save();

        // Send welcome email with the verification link
        await sendWelcomeEmail(req.user.email, req.user.username, token);

        req.flash('success', 'Verification email sent successfully! Please check your inbox.');
        res.redirect('/verification');
    } catch (error) {
        console.error('Error resending verification email:', error);
        req.flash('error', 'An error occurred while resending the verification email. Please try again later.');
        res.redirect('/tenancy-manager/dashboard');
    }
});

const sendWelcomeEmail = async (email, username, verificationToken) => {
    const mailOptions = {
        from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
        to: email,
        subject: 'Welcome to Lease Captain! Please Verify Your Email',
        html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to Lease Captain!</title>
<style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #ffffff;
                        margin: 0;
                        padding: 0;
                        color: #000000;
                    }
                    .container {
                        width: 100%;
                        max-width: 600px;
                        margin: 0 auto;
                        background-color: #ffffff;
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    }
                    .header {
                        background-color: #003366;
                        padding: 10px;
                        text-align: center;
                        color: white;
                        border-radius: 8px 8px 0 0;
                    }
                    .header h1 {
                        margin: 0;
                        font-size: 24px;
                    }
                    .content {
                        padding: 20px;
                        line-height: 1.6;
                    }
                    .cta-button {
                        display: inline-block;
                        padding: 12px 20px;
                        background-color: #003366;
                        color: white;
                        text-decoration: none;
                        border-radius: 5px;
                        margin-top: 10px;
                        text-align: center;
                    }
                    .cta-button:hover {
                        background-color: #00509E;
                    }
                </style>
        </head>
        <body>
           <div class="email-container">
    <h1>Welcome to Lease Captain!</h1>
    <p>Hi ${username},</p>
    <p>Thank you for signing up! Please verify your email address by clicking the link below:</p>
    <p><a href="https://leasecaptain.com/verify/${verificationToken}">Verify Email</a></p>
    <p>If you did not sign up for this account, you can ignore this email.</p>
    <p>Best regards,<br>Lease Captain Team</p>
</div>

        </body>
        </html>
      `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Welcome email sent successfully.');
    } catch (error) {
        console.error('Error sending welcome email:', error);
    }
};

const planAmounts = {
    Basic: 0,
    Standard: 1499,
    Pro: 2999,
    Advanced: 4499,
    Enterprise: 6999,
    Premium: null
};

router.get('/tenancy-manager/dashboard', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Check if user is verified
        if (!req.user.isVerified) {
            req.flash('error', 'Please verify your account to access the dashboard.');
            return res.redirect('/verification');
        }

        const expectedAmount = planAmounts[req.user.plan];

        // Check if user has paid or if they are on the Basic plan
        const hasPaid = (req.user.plan === 'Basic') ||
            (req.user.paymentStatus &&
                req.user.paymentStatus.status === 'completed' &&
                req.user.paymentStatus.amount === expectedAmount);

        if (!hasPaid) {
            if (req.user.plan === 'Basic') {
                req.flash('error', 'As a Basic plan user, you have limited access.');
                return res.redirect('/tenancy-manager/dashboard');
            } else {
                req.flash('error', 'Please complete your subscription payment to access our services.');
                return res.redirect('/subscription');
            }
        }

// Fetch properties, units, tenants, and payments
const properties = await Property.find({ owner: req.user._id }).populate('tenants');
const propertyUnits = await PropertyUnit.find({ owner: req.user._id }).populate('tenant'); // Fetch property units
const tenants = await Tenant.find({ owner: req.user._id }); // Fetch tenants
const payments = await Payment.find({ owner: req.user._id }).sort({ createdAt: -1 }).limit(5);

        // Get current month
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        // Monthly metrics
        let totalRentCollected = 0;
        let totalRentDue = 0;
        let utilityCollected = 0;
        let utilityDue = 0;


        tenants.forEach(tenant => {
            const rentPaid = tenant.rentPaid || 0;
            const totalRent = tenant.totalRent || 0;

            // Check if the current month's rent is included
            const currentMonthPaid = tenant.currentMonthPaid || false;

            // Add current month's rent to rent due if it is not paid
            const rentDue = currentMonthPaid ? Math.max(0, totalRent - rentPaid) : Math.max(0, totalRent - rentPaid + tenant.monthlyRent || 0);

            const utilityPaid = tenant.utilityPaid || 0;
            const utilityDueForTenant = Math.max(0, (tenant.totalUtility || 0) - utilityPaid);

            totalRentCollected += rentPaid;
            totalRentDue += rentDue;

            utilityCollected += utilityPaid;
            utilityDue += utilityDueForTenant;
        });

        const monthlyRentData = tenants.reduce((acc, tenant) => {
            const leaseMonth = new Date(tenant.leaseEndDate).getMonth();
            const leaseYear = new Date(tenant.leaseEndDate).getFullYear();

            if (leaseYear === currentYear) {
                if (!acc[leaseMonth]) {
                    acc[leaseMonth] = { collected: 0, due: 0 };
                }
                acc[leaseMonth].collected += tenant.rentPaid || 0;
                acc[leaseMonth].due += Math.max(0, (tenant.totalRent || 0) - (tenant.rentPaid || 0));
            }
            return acc;
        }, {});

        // Monthly metrics for the current month
        const monthlyData = monthlyRentData[currentMonth] || { collected: 0, due: 0 };
        const monthlyCollected = monthlyData.collected;
        const monthlyDue = monthlyData.due;

        // Additional key metrics
        const totalExpectedRent = tenants.reduce((sum, tenant) => sum + (tenant.totalRent || 0), 0);
        const tenantRetention = (tenants.filter(t => t.status === 'occupied').length / tenants.length) * 100 || 0;


        // Fetch all expenses for the owner 
        const expenses = await Expense.aggregate([
            { $match: { owner: req.user._id } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        // Total expenses (if no expenses found, default to 0)
        const totalExpenses = expenses[0]?.total || 0;


        const totalProfit = totalRentCollected - totalExpenses;
        const totalUtility = tenants.reduce((sum, tenant) => sum + (tenant.totalUtility || 0), 0);

// Prepare all months and rent collection data
const allMonths = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// Initialize rent collection data for all months
const rentCollectionData = {};
allMonths.forEach(month => {
    rentCollectionData[month] = { collected: 0, due: 0 };
});

// Aggregate rent data by the month of payment
tenants.forEach(tenant => {
    const rentPaid = tenant.rentPaid || 0; // Total rent collected from this tenant
    const rentDue = (tenant.totalRent || 0) - rentPaid; // Total rent due from this tenant

    const month = new Date(tenant.leaseStartDate).toLocaleString('default', { month: 'short' });

    if (rentCollectionData[month]) {
        rentCollectionData[month].collected += rentPaid;
        rentCollectionData[month].due += rentDue;
    }
});

// Convert rent data into an array for rendering
const rentDataArray = allMonths.map(month => ({
    month,
    collected: rentCollectionData[month].collected,
    due: rentCollectionData[month].due,
}));

// Pass rentDataArray to the frontend



        // Calculate occupied tenants
        const occupiedTenants = tenants.filter(tenant => tenant.status === 'occupied').length;

        // Calculate percentages
        const rentCollectedPercentage = (totalRentCollected / totalExpectedRent) * 100;
        const expensesPercentage = (totalExpenses / totalExpectedRent) * 100;
        const profitPercentage = (totalProfit / totalExpectedRent) * 100;
        const tenantPercentage = (occupiedTenants / tenants.length) * 100;

        const userProgress = {
            hasProperties: properties.length > 0,
            hasPropertyUnits: tenants.length > 0,
            hasTenants: tenants.length > 0
        };

        // Count maintenance requests associated with the user's tenants
        const totalRequests = await MaintenanceRequest.countDocuments({
            tenantId: { $in: tenants.map(tenant => tenant._id) }
        });

        // Render the dashboard
        res.render('tenancyManager/dashboard', {
            properties,
            propertyUnits,
            tenants,
            totalTenants: tenants.length,
            payments,
            monthlyCollected,
            monthlyDue,
            totalExpectedRent,
            tenantRetention,
            totalProfit,
            totalRentCollected,
            totalRentDue,
            utilityCollected,
            utilityDue,
            totalUtility,
            totalExpenses,
            totalRequests,
            rentDataArray,
            rentCollectedPercentage,
            expensesPercentage,
            profitPercentage,
            tenantPercentage,

            numberOfTenants: tenants.length,
            occupiedUnitsCount: tenants.filter(t => t.status === 'occupied').length,
            userProgress,
            rentDataArray: Object.keys(monthlyRentData).map(month => ({
                month: new Date(currentYear, month).toLocaleString('default', { month: 'short' }),
                collected: monthlyRentData[month].collected,
                due: monthlyRentData[month].due
            })),
            currentUser: req.user
        });
    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        req.flash('error', 'Error fetching dashboard data.');
        res.redirect('/login');
    }
});



router.get('/subscription', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error', 'Please log in to view subscription details.');
            return res.redirect('/login');
        }

        const planAmounts = {
            Basic: 0,
            Standard: 1499,
            Pro: 2999,
            Advanced: 4499,
            Enterprise: 6999,
            Premium: null,
        };

        const planDetails = {
            Basic: { amount: 0, units: 5 },
            Standard: { amount: 1499, units: 20 },
            Pro: { amount: 2999, units: 50 },
            Advanced: { amount: 4499, units: 10 },
            Enterprise: { amount: 6999, units: 150 },
            Premium: { amount: null, units: "Contact Support for Pricing" },
        };

        const expectedAmount = planAmounts[req.user.plan] || 0; // Default to 0 if undefined
        const hasPaid = req.user.paymentStatus?.status === 'completed';

        if (hasPaid) {
            req.flash('success', 'You have already paid for this subscription.');
            return res.redirect('/tenancy-manager/dashboard');
        }

        res.render('subscription', {
            plan: req.user.plan,
            expectedAmount,
            hasPaid,
            currentUser: req.user,
            planDetails,
            messages: {
                success: req.flash('success') || [],
                error: req.flash('error') || [],
                info: req.flash('info') || [],
            },
        });
    } catch (err) {
        console.error('Error loading subscription page:', err);
        req.flash('error', 'An error occurred while loading the subscription page. Please try again later.');
        return res.redirect('/dashboard');
    }
});

async function sendPaymentRequest(payload, req, res) {
    try {
        const transactionId = `LC${Math.floor(100000 + Math.random() * 900000)}`;
        payload.transaction_id = transactionId;

        console.log('Sending payment initiation request with payload:', payload);

        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/intiatestk',
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );

        console.log('Payment initiation response:', response.data);

        const transactionRequestId = response.data.tranasaction_request_id || null;

        if (response.status === 200 && transactionRequestId) {
            console.log('Payment request successful:', response.data);
            req.flash('info', 'Payment request initiated successfully! Please enter your Mpesa pin to complete the payment.');
            return { success: '200', transaction_request_id: transactionRequestId };
        } else {
            console.error('Invalid response from payment initiation:', response.data);
            req.flash('error', 'Payment request failed. Please try again.');
            return { success: 'error' };
        }
    } catch (err) {
        console.error('Payment request failed:', err.message);
        req.flash('error', `Error: ${err.message || 'Unknown error occurred during payment request.'}`);
        return { success: 'error' };
    }
}

async function pollPaymentStatus(transactionRequestId, transactionId, api_key, email, expectedAmount, user, plan, req, res) {
    const pollingInterval = 5000; // 5 seconds
    const pollingTimeout = 60000; // 1 minute
    const startTime = Date.now();
    let responseSent = false;

    const interval = setInterval(async () => {
        if (responseSent) {
            clearInterval(interval);
            return;
        }

        try {
            const verificationPayload = {
                api_key,
                email,
                transaction_id: transactionId,
                tranasaction_request_id: transactionRequestId,
            };

            console.log('Verifying payment with payload:', verificationPayload);

            const response = await axios.post(
                'https://api.umeskiasoftwares.com/api/v1/transactionstatus',
                verificationPayload,
                { headers: { 'Content-Type': 'application/json' } }
            );

            if (response && response.data) {
                const { ResultCode, TransactionStatus, TransactionAmount } = response.data;

                if (TransactionStatus === 'Completed' && ResultCode === '200') {
                    clearInterval(interval);
                    responseSent = true;

                    if (parseFloat(TransactionAmount) >= parseFloat(expectedAmount)) {
                        // Update payment status only once
                        user.paymentStatus = {
                            status: 'completed',
                            transactionId,
                            amount: TransactionAmount,
                            plan,
                        };

                        // Send invoice
                        await sendInvoice(user, transactionId, TransactionAmount, plan);

                        req.flash('success', `Payment completed! Welcome to the ${plan} plan.`);
                        return res.redirect('/tenancy-manager/dashboard');
                    } else {
                        req.flash('error', 'Insufficient payment amount. Please try again.');
                        return res.redirect('/subscription');
                    }
                } else if (TransactionStatus === 'Pending') {
                    console.log('Payment pending. Continuing polling...');
                } else {
                    clearInterval(interval);
                    responseSent = true;
                    req.flash('error', 'Payment failed. Please try again.');
                    return res.redirect('/subscription');
                }
            } else {
                console.error('Invalid response during payment verification:', response);
                clearInterval(interval);
                req.flash('error', 'An error occurred during payment verification. Please try again.');
                return res.redirect('/subscription');
            }
        } catch (error) {
            console.error('Error during payment verification:', error.message);
            clearInterval(interval);
            req.flash('error', 'An error occurred during payment verification. Please try again.');
            return res.redirect('/subscription');
        }

        // Timeout handling
        if (Date.now() - startTime > pollingTimeout) {
            clearInterval(interval);
            if (!responseSent) {
                responseSent = true;
                req.flash('error', 'Payment verification timed out. Please check back later.');
                return res.redirect('/subscription');
            }
        }
    }, pollingInterval);
}

async function sendInvoice(user, transactionId, amount) {
    // Avoid re-sending emails or SMS
    if (user.invoiceSent) {
        console.log('Invoice already sent, skipping...');
        return;
    }

    try {
        // Send invoice email
        await sendInvoiceEmail(user, {
            reference: transactionId,
            amount,
            date: new Date().toLocaleString(),
            status: 'Completed',
        });

        console.log('Invoice email sent to', user.email);

        // Send SMS
        const smsResponse = await sendInvoiceSMS(user, {
            reference: transactionId,
            amount,
        });

        console.log('Invoice SMS response:', smsResponse);

        // Update the user object to reflect that the invoice has been sent
        user.invoiceSent = true;
        await user.save();
    } catch (error) {
        console.error('Error sending invoice:', error.message);
    }
}

router.post('/subscription', async (req, res) => {
    const { msisdn, amount, plan } = req.body;
    const user = req.user;

    try {
        const payload = {
            api_key: 'VEpGOTVNTlY6dnUxaG5odHA=',
            email: 'vickinstechnologies@gmail.com',
            account_id: 'UMPAY772831690',
            amount,
            msisdn,
            reference: `L-${Date.now()}`,
        };

        const paymentResponse = await sendPaymentRequest(payload, req, res);

        if (paymentResponse.success === '200') {
            const transactionRequestId = paymentResponse.transaction_request_id || paymentResponse.tranasaction_request_id;

            if (!transactionRequestId) {
                req.flash('error', 'Transaction request ID is missing. Payment initiation failed.');
                return res.redirect('/subscription');
            }

            console.log('Transaction Request ID:', transactionRequestId);

            const transactionId = `LC${Math.floor(100000 + Math.random() * 900000)}`;

            await pollPaymentStatus(transactionRequestId, transactionId, payload.api_key, payload.email, amount, user, plan, req, res);
        } else {
            req.flash('error', 'Payment initiation failed. Please try again.');
            return res.redirect('/subscription');
        }
    } catch (error) {
        console.error(error);
        req.flash('error', 'Payment initiation failed. Please try again.');
        return res.redirect('/subscription');
    }
});

const sendInvoiceEmail = async (user, invoiceDetails) => {
    try {
        const mailOptions = {
            from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
            to: user.email,
            subject: `Invoice for Your Payment: ${invoiceDetails.reference}`,
            html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f9f9f9;
                        margin: 0;
                        padding: 0;
                        color: #333333;
                    }
                    .container {
                        width: 100%;
                        max-width: 600px;
                        margin: 20px auto;
                        background-color: #ffffff;
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    }
                    .header {
                        text-align: center;
                        background-color: #003366;
                        padding: 15px;
                        border-radius: 8px 8px 0 0;
                        color: #ffffff;
                    }
                    .header h1 {
                        margin: 0;
                    }
                    .content {
                        line-height: 1.6;
                        padding: 20px;
                    }
                    .footer {
                        text-align: center;
                        font-size: 12px;
                        color: #666666;
                        padding: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Payment Invoice</h1>
                    </div>
                    <div class="content">
                        <p>Dear ${user.username},</p>
                        <p>Thank you for your payment. Below are the details of your transaction:</p>
                        <table>
                            <tr><td><strong>Reference:</strong></td><td>${invoiceDetails.reference}</td></tr>
                            <tr><td><strong>Amount:</strong></td><td>KES ${invoiceDetails.amount}</td></tr>
                            <tr><td><strong>Date:</strong></td><td>${invoiceDetails.date}</td></tr>
                            <tr><td><strong>Status:</strong></td><td>${invoiceDetails.status}</td></tr>
                        </table>
                        <p>If you have any questions or require support, feel free to reach out to our team.</p>
                        <p>Best regards,<br>Lease Captain Team</p>
                    </div>
                    <div class="footer">
                        <p>&copy; 2024 Lease Captain. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Invoice email sent to ${user.email}`);
    } catch (error) {
        console.error('Error sending invoice email:', error);
    }
};

const sendInvoiceSMS = async (user, invoiceDetails) => {
    const message = `Dear ${user.name}, thank you for your payment. Reference: ${invoiceDetails.reference}, Amount: KES ${invoiceDetails.amount}. Check your email for the detailed invoice.`;

    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',
            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message: message,
                phone: user.phone
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        console.log('Invoice SMS sent successfully via UMS API:', response.data);
    } catch (error) {
        console.error('Error sending invoice SMS via UMS API:', error.response ? error.response.data : error.message);
    }
};

// POST endpoint to handle support form submission
router.post('/submit', async (req, res) => {
    const { emailAddress, supportMessage } = req.body;

    if (!emailAddress || !supportMessage) {
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect('/tenancy-manager/dashboard');
    }

    try {
        // Save the support message to the database
        const newMessage = new SupportMessage({
            email: emailAddress,
            message: supportMessage,
            submittedAt: new Date()
        });
        await newMessage.save();

        // Set up email options
        const mailOptions = {
            from: 'vickinstechnologies@gmail.com',
            to: 'vickievokes360@gmail.com',
            subject: 'New Support Message',
            text: `You have received a new support message from ${emailAddress}:\n\n${supportMessage}`
        };

        // Send email using the transporter
        await transporter.sendMail(mailOptions);

        req.flash('success', 'Your support message has been sent successfully.');
        res.redirect('/tenancy-manager/dashboard');
    } catch (error) {
        console.error('Error sending support message:', error);
        req.flash('error', 'An error occurred while sending your message.');
        res.redirect('/tenancy-manager/dashboard');
    }
});

// Serve User Profile Page
router.get('/tenancy-manager/profile', isTenancyManager, async (req, res) => {
    console.log('Session data:', req.session);

    try {

        if (!req.session.passport || !req.session.passport.user) {
            console.log('No user information in session.');
            req.flash('error', 'You need to log in to view this page.');
            return res.redirect('/login');
        }

        const userId = req.session.passport.user;
        const user = await User.findById(userId);

        if (!user) {
            req.flash('error', 'User not found.');
            return res.status(404).redirect('/tenancy-manager/profile');
        }


        res.render('tenancyManager/profile', { user, currentUser: user });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        req.flash('error', 'An error occurred while fetching your profile. Please try again later.');
        res.status(500).redirect('/tenancy-manager/profile');
    }
});

// Serve User Security Page
router.get('/tenancy-manager/security', isTenancyManager, async (req, res) => {
    try {
        const userId = req.session.passport.user;
        const user = await User.findById(userId).lean();

        if (!user) {
            return res.status(404).send('User not found');
        }

        const recentLoginActivity = (user.loginActivity || []).slice(-5).reverse();

        res.render('tenancyManager/security', {
            user,
            currentUser: user,
            loginActivity: recentLoginActivity
        });
    } catch (error) {
        console.error('Error fetching user security settings:', error);
        res.status(500).send('Error fetching user security settings');
    }
});

// Change Password Route
router.post('/tenancy-manager/security', isTenancyManager, async (req, res) => {
    try {
        const userId = req.session.passport.user;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send('User not found');
        }

        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate the current password using the authenticate method
        user.authenticate(currentPassword, async (err, authenticatedUser) => {
            if (err || !authenticatedUser) {
                req.flash('error', 'Current password is incorrect.');
                return res.redirect('/tenancy-manager/security');
            }

            // Check if new passwords match
            if (newPassword !== confirmPassword) {
                req.flash('error', 'New passwords do not match.');
                return res.redirect('/tenancy-manager/security');
            }

            // Set the new password
            user.setPassword(newPassword, async (err) => {
                if (err) {
                    req.flash('error', 'Error setting new password.');
                    return res.redirect('/tenancy-manager/security');
                }
                await user.save(); // Save user after setting the password
                req.flash('success', 'Password changed successfully!');
                res.redirect('/tenancy-manager/security');
            });
        });
    } catch (error) {
        console.error('Error changing password:', error);
        req.flash('error', 'An error occurred while changing the password.');
        res.redirect('/tenancy-manager/security');
    }
});

// Update User Profile by ID
router.post('/tenancy-manager/profile/:id', isTenancyManager, async (req, res) => {
    try {
        const userId = req.params.id; // Retrieve user ID from route parameters
        const { username, email } = req.body;

        // Validate required fields
        if (!username || !email) {
            req.flash('error', 'Username and email are required.');
            return res.redirect(`/tenancy-manager/profile`);
        }

        // Validate email format (basic validation)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            req.flash('error', 'Please provide a valid email address.');
            return res.redirect(`/tenancy-manager/profile`);
        }

        // Prepare updates
        const updates = { username, email };

        // Update user in the database
        const updatedUser = await User.findByIdAndUpdate(userId, updates, { new: true });
        if (!updatedUser) {
            req.flash('error', 'User not found.');
            return res.redirect(`/tenancy-manager/profile`);
        }

        req.flash('success', 'Profile updated successfully!');
        res.redirect(`/tenancy-manager/profile`);
    } catch (error) {
        console.error('Error updating user profile:', error);
        req.flash('error', 'Failed to update profile. Please try again later.');
        res.redirect(`/tenancy-manager/profile`);
    }
});


const getMaxTenants = (plan) => {
    const tenantsLimit = {
        Basic: 5,
        Standard: 20,
        Pro: 50,
        Advanced: 100,
        Enterprise: 150,
        Premium: Infinity,
    };

    return tenantsLimit[plan] || 0;
};

router.post('/tenancy-manager/tenant/new', async (req, res) => {
    const {
        name, email, address, phone, leaseStartDate, leaseEndDate, property, deposit, utilities, unitId, doorNumber,
        rentPaid, utilityPaid
    } = req.body;

    // Validate required fields
    const requiredFields = [
        { field: leaseStartDate, message: 'Lease start date is required' },
        { field: leaseEndDate, message: 'Lease end date is required' },
        { field: property, message: 'Property is required' },
        { field: name, message: 'Name is required' },
        { field: email, message: 'Email is required' },
        { field: deposit, message: 'Deposit is required' },
        { field: utilities, message: 'Utilities are required' },
        { field: unitId, message: 'Unit ID is required' },
        { field: doorNumber, message: 'Door number is required' }
    ];

    for (const { field, message } of requiredFields) {
        if (!field) {
            req.flash('error', message);
            return res.redirect('/tenancy-manager/tenants');
        }
    }

    // Additional date validation
    if (!Date.parse(leaseStartDate)) {
        req.flash('error', 'Invalid Lease start date. Please provide a valid date.');
        return res.redirect('/tenancy-manager/tenants');
    }

    if (!Date.parse(leaseEndDate)) {
        req.flash('error', 'Invalid Lease end date. Please provide a valid date.');
        return res.redirect('/tenancy-manager/tenants');
    }

    const startDate = new Date(leaseStartDate);
    const endDate = new Date(leaseEndDate);

    // Ensure lease end date is not before lease start date
    if (endDate < startDate) {
        req.flash('error', 'Lease end date cannot be earlier than Lease start date.');
        return res.redirect('/tenancy-manager/tenants');
    }

    const currentUser = req.user;

    try {
        // Check if the property exists
        const propertyToCheck = await Property.findById(property);
        if (!propertyToCheck) {
            req.flash('error', 'Property not found');
            return res.redirect('/tenancy-manager/tenants');
        }

        const propertyName = propertyToCheck.name;

        // Check if the user owns the property
        if (propertyToCheck.owner.toString() !== currentUser._id.toString()) {
            req.flash('error', 'You do not have permission to add tenants to this property');
            return res.redirect('/tenancy-manager/tenants');
        }

        const maxTenants = getMaxTenants(currentUser.plan);
        const tenantCount = await Tenant.countDocuments({ owner: currentUser._id });

        if (tenantCount >= maxTenants) {
            req.flash(
                'error',
                `Tenant limit reached for your ${currentUser.plan} plan. Upgrade to add more tenants.`
            );
            return res.redirect('/tenancy-manager/tenants');
        }

        const existingTenant = await Tenant.findOne({ $or: [{ name }, { email }] });
        if (existingTenant) {
            req.flash('error', `Tenant with name ${name} or email ${email} already exists. Please try again.`);
            return res.redirect('/tenancy-manager/tenants');
        }

        // Set default password and hash it
        const defaultPassword = '12345678';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        // Initialize wallet balance as the negative of the deposit amount
        const walletBalance = -deposit;

        // Create new tenant
        const newTenant = new Tenant({
            name,
            email,
            address,
            phone,
            deposit,
            utilities,
            username: name.toLowerCase().replace(/\s+/g, ''),
            password: hashedPassword,
            leaseStartDate,
            leaseEndDate,
            property: propertyToCheck._id,
            owner: currentUser._id,
            userId: currentUser._id,
            unit: unitId,
            doorNumber,
            walletBalance,
            rentPaid: rentPaid || 0,
            utilityPaid: utilityPaid || 0
        });

        await newTenant.save();

        // Send SMS and Email with propertyName included
        await sendWelcomeSMS({
            phone: phone,
            name: name,
            propertyName: propertyName
        });

        await sendTenantEmail(newTenant, propertyToCheck.name);

        req.flash('success', 'Tenant added successfully and email sent.');
        res.redirect('/tenancy-manager/tenants');

    } catch (error) {
        console.error('Error adding tenant:', error);
        req.flash('error', 'Error adding tenant.');
        return res.redirect('/tenancy-manager/tenants');
    }
});

// Function to send tenant email separately
async function sendTenantEmail(newTenant, propertyName) {

    try {
        const mailOptions = {
            from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
            to: newTenant.email,
            subject: 'Lease Captain Tenant Portal Logins!',
            html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #ffffff;
                        margin: 0;
                        padding: 0;
                        color: #000000;
                    }
                    .container {
                        width: 100%;
                        max-width: 600px;
                        margin: 0 auto;
                        background-color: #ffffff;
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    }
                    .header {
                        background-color: #003366;
                        padding: 10px;
                        text-align: center;
                        color: white;
                        border-radius: 8px 8px 0 0;
                    }
                    .header h1 {
                        margin: 0;
                        font-size: 24px;
                    }
                    .content {
                        padding: 20px;
                        line-height: 1.6;
                    }
                    .cta-button {
                        display: inline-block;
                        padding: 12px 20px;
                        background-color: #003366;
                        color: white;
                        text-decoration: none;
                        border-radius: 5px;
                        margin-top: 10px;
                        text-align: center;
                    }
                    .cta-button:hover {
                        background-color: #00509E;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Welcome to Lease Captain Tenant Portal</h1>
                    </div>
                    <div class="content">
                        <h2>Greetings ${newTenant.name},</h2>
                        <p>Welcome to your new home at <strong>${propertyName}</strong>! Your account has been successfully created. You can now access your tenant portal to manage your account.</p>
                        <h3>Your Account Details:</h3>
                        <p><strong>Username:</strong> ${newTenant.name}<br><strong>Password:</strong> 12345678</p>
                        <h3>How to Log In:</h3>
                        <p>Click the link below to access the Tenant Portal:</p>
                        <p><a href="https://leasecaptain.com/tenantPortal/login" class="cta-button"><strong>Access Your Tenant Portal</strong></a></p>
                     <p>Once logged in, we recommend changing your password for security purposes.</p>
                        <h3>Next Steps:</h3>
                        <ul>
                            <li>View your property details</li>
                            <li>Make rent payments</li>
                            <li>Submit maintenance requests</li>
                        </ul>
                        <p>Contact support in case of any queries</p>
                    </div>
                    <div class="footer">
                        <p>&copy; 2024 Lease Captain. All Rights Reserved</p>
                    </div>
                </div>
            </body>
            </html>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${newTenant.email}`);
    } catch (emailError) {
        console.error('Error sending email:', emailError);
    }
}
const sendWelcomeSMS = async (tenant) => {
    const { phone, name, propertyName } = tenant;
    const message = `Dear ${name}, welcome to your new home at ${propertyName}! Use the credentials sent to your email to log in to your portal. Access it here: leasecaptain.com/tenantPortal/login.`;

    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',

            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message: message,
                phone: phone
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        console.log('Welcome SMS sent successfully via UMS API:', response.data);
    } catch (error) {
        console.error('Error sending SMS via UMS API:', error.response ? error.response.data : error.message);
    }
};


// Route to resend the welcome email to a tenant
router.post('/tenancy-manager/tenant/resend-email/:tenantId', async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        const tenant = await Tenant.findById(tenantId);

        if (!tenant) {
            req.flash('error', 'Tenant not found');
            return res.redirect('/tenancy-manager/tenants');
        }

        // Fetch the associated property name
        const property = await Property.findById(tenant.property);
        const propertyName = property ? property.name : 'Your Property';

        // Resend the welcome email
        await sendTenantEmail(tenant, propertyName);

        req.flash('success', `Welcome email resent to ${tenant.name}`);
        res.redirect('/tenancy-manager/tenants');
    } catch (error) {
        console.error('Error resending email:', error);
        req.flash('error', 'Error resending email to tenant');
        res.redirect('/tenancy-manager/tenants');
    }
});

router.get('/tenancy-manager/payments', isTenancyManager, async (req, res) => {
    try {
        const pageSize = 10;
        const currentPage = Number(req.query.page) || 1;
        const searchQuery = req.query.search || '';
        const regex = new RegExp(searchQuery, 'i');
        const currentUser = req.user;

        // Fetch tenant and property data
        const tenants = await Tenant.find({ owner: currentUser._id }).select('_id name doorNumber');
        const properties = await Property.find({ owner: currentUser._id }).select('_id name');

        // Fetch tenant IDs for the logged-in user
        const tenantIds = tenants.map(tenant => tenant._id);

        // Build search condition
        const searchCondition = {
            tenant: { $in: tenantIds },
            $or: [
                { tenantName: regex },
                { 'tenant.email': regex },
                { 'tenant.property.name': regex }
            ]
        };

        // Count total payments
        const totalPayments = await Payment.countDocuments(searchCondition);

        // Fetch payments with pagination
        const payments = await Payment.find(searchCondition)
            .populate({
                path: 'tenant',
                populate: [
                    { path: 'property', select: 'name' },
                    { path: 'unit', select: 'name' }
                ]
            })
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize)
            .sort({ datePaid: -1 });

        const totalPages = Math.ceil(totalPayments / pageSize);

        // Render the payments view with tenants, properties, and other data
        res.render('tenancyManager/payments', {
            title: 'Manage Payments',
            payments,
            tenants,   // Pass tenants data to the view
            properties, // Pass properties data to the view
            currentPage,
            totalPages,
            pageSize,
            currentUser,
            searchQuery,
        });
    } catch (error) {
        console.error("Error fetching payments:", error);
        req.flash('error', 'Internal Server Error while fetching payments.');
        res.redirect('/tenancy-manager/payments');
    }
});

router.get('/api/tenants/:id', async (req, res) => {
    const tenantId = req.params.id;
    try {
      const tenant = await Tenant.findById(tenantId).populate('property'); // Adjust to your schema
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  
      res.json({
        property: tenant.property.name, // Or another field relevant to property
        unitType: tenant.unit.unitType, // Fetching unitType instead of unit
        doorNumber: tenant.doorNumber,
      });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });
  

router.get('/reports-invoices', async (req, res) => {
    try {
        const { property, dateFrom, dateTo } = req.query;
        const currentPage = req.query.page || 1;
        const pageSize = 10;

        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Filter for the payments/reports
        let filter = {};
        if (property && property !== 'all') {
            filter.propertyName = property;
        }

        if (dateFrom && dateTo) {
            filter.createdAt = {
                $gte: new Date(dateFrom),
                $lte: new Date(dateTo),
            };
        }

        // Fetch reports (Payments)
        const totalRecords = await Payment.countDocuments(filter);
        const paginatedReports = await Payment.find(filter)
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);

        // Fetch invoices
        const invoices = await Invoice.find();

        // Fetch properties to populate dropdown
        const properties = await Property.find().select('name');

        // Render the view with the data
        res.render('tenancyManager/reports&invoices', {
            reports: paginatedReports,
            properties,
            invoices,                    // Pass the fetched invoices to the view
            currentPage: parseInt(currentPage),
            pageSize,
            totalRecords,
            currentUser: req.user,
            selectedProperty: property || 'all',
            dateFrom,
            dateTo,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

router.get('/expenses', async (req, res) => {
    try {
        const pageSize = 10;
        const currentPage = Number(req.query.page) || 1;
        const searchQuery = req.query.search || '';

        // Ensure the user is authenticated
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Fetch expenses for the logged-in user only and apply search, pagination
        const expenses = await Expense.find({
            owner: req.user._id, // Filter by the logged-in user's ID
            name: { $regex: searchQuery, $options: 'i' } // Apply search query
        })
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);

        // Count total expenses for pagination (filtered by user and search query)
        const totalExpenses = await Expense.countDocuments({
            owner: req.user._id, // Filter by the logged-in user's ID
            name: { $regex: searchQuery, $options: 'i' }
        });

        const totalPages = Math.ceil(totalExpenses / pageSize);

        res.render('tenancyManager/expense', {
            expenses,
            currentPage,
            totalPages,
            pageSize,
            currentUser: req.user
        });
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/expenses', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        const newExpense = new Expense({
            owner: req.user._id,
            name: req.body.name,
            category: req.body.category,
            amount: req.body.amount,
            date: req.body.date,
            status: req.body.status
        });

        await newExpense.save();
        req.flash('success', 'Expense created successfully.');
        res.redirect('/expenses');
    } catch (error) {
        console.error('Error creating expense:', error);
        req.flash('error', 'Error creating expense.');
        res.redirect('/expenses');
    }
});

// Pass the predefined permissions to the view
router.get('/roles', isTenancyManager, async (req, res) => {
    try {
        const roles = await Role.find();
        const permissions = await Permission.find();

        res.render('tenancyManager/roles', {
            roles,
            currentUser: req.user,
            permissions,
            error: null,
            success: null
        });
    } catch (err) {
        res.render('tenancyManager/roles', {
            roles: [],
            permissions: [],
            error: 'Error fetching roles or permissions.',
            success: null
        });
    }
});

// Users route
router.get('/users', isTenancyManager, async (req, res) => {
    try {
        // Log the current user to verify that user information is available
        console.log("Logged-in User:", req.user);

        // Fetch users created by the logged-in user
        const users = await User.find({ createdBy: req.user._id }).populate('roles');

        console.log("Fetched Users:", users); // Log the fetched users for debugging

        const roles = await Role.find();

        res.render('tenancyManager/users', {
            users,
            roles,
            currentUser: req.user,
            error: req.flash('error') || null,
            success: req.flash('success') || null
        });
    } catch (err) {
        console.error('Error fetching users or roles:', err);

        // Handle error and render the page with the error message
        res.render('tenancyManager/users', {
            users: [],
            roles: [],
            currentUser: req.user,
            error: 'Error fetching users or roles. Please try again later.',
            success: null
        });
    }
});

// Route to create a new user with multiple roles using passport-local-mongoose
router.post('/users/create', async (req, res) => {
    try {
        const { username, email, password, roleIds } = req.body;

        if (!roleIds || roleIds.length === 0) {
            req.flash('error', 'Please select at least one role.');
            return res.redirect('/users/create');
        }

        // Find the roles based on roleIds
        const roles = await Role.find({ _id: { $in: roleIds } });

        if (roles.length === 0) {
            req.flash('error', 'No valid roles found.');
            return res.redirect('/users/create');
        }

        const newUser = new User({
            username,
            email,
            roles: roles.map(role => role._id),
            createdBy: req.user._id,
            accountId: req.user.accountId || req.user._id
        });

        User.register(newUser, password, function (err, user) {
            if (err) {
                console.error('Error registering user:', err);
                req.flash('error', 'Error creating user.');
                return res.redirect('/users/create');
            }

            req.flash('success', 'User created successfully.');
            res.redirect('/users');
        });
    } catch (err) {
        console.error('Error creating user:', err);
        req.flash('error', 'Error creating user.');
        res.redirect('/users/create');
    }
});

// Route to assign a role to a user
router.post('/users/:id/assign-role', async (req, res) => {
    try {
        const { id } = req.params;
        const { roleId } = req.body;

        // Find the user by ID
        const user = await User.findById(id);

        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/users');
        }

        // Find the role by ID
        const role = await Role.findById(roleId);

        if (!role) {
            req.flash('error', 'Role not found.');
            return res.redirect('/users');
        }

        // Assign the role to the user
        user.role = role._id;
        await user.save();

        req.flash('success', 'Role assigned successfully.');
        res.redirect('/users');
    } catch (err) {
        console.error('Error assigning role to user:', err);
        req.flash('error', 'Error assigning role to user.');
        res.redirect('/users');
    }
});

router.post('/users/:id/delete', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        req.flash('success', 'User deleted successfully.');
        res.redirect('/users');
    } catch (err) {
        console.error('Error deleting user:', err);
        req.flash('error', 'Error deleting user.');
        res.redirect('/users');
    }
});

// GET maintenance requests
router.get('/maintenance-requests', isTenancyManager, async (req, res) => {
    try {
        // Check if the user is authenticated
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Find all tenants where the owner is the logged-in user
        const tenants = await Tenant.find({ owner: req.user._id }).select('_id');

        // Fetch maintenance requests only for the tenants of the logged-in user
        const requests = await MaintenanceRequest.find({ tenantId: { $in: tenants } })
            .populate('tenantId propertyId');

        // Fetch success or error messages, if any
        const messages = {
            success: req.flash('success'),
            error: req.flash('error')
        };

        // Render the maintenance request page with the fetched data
        res.render('tenancyManager/maintenanceRequest', {
            requests,
            currentUser: req.user,
            messages
        });
    } catch (err) {
        // Log the error and redirect if an issue occurs
        console.error('Error fetching maintenance requests:', err);
        req.flash('error', 'Error fetching maintenance requests.');
        res.redirect('/tenancy-manager/dashboard');
    }
});


//POST Maintenance Request
router.post('/maintenance-requests/:id', isTenancyManager, async (req, res) => {
    try {

        const { id } = req.params;

        const { status } = req.body;

        await MaintenanceRequest.findByIdAndUpdate(id, { status }, { new: true });

        req.flash('success', 'Maintenance request updated successfully.');

        res.redirect('/maintenance-requests');

    } catch (err) {

        console.error('Error updating maintenance request:', err);

        req.flash('error', 'Error updating maintenance request.');

        res.redirect('/maintenance-requests');
    }
});


router.post('/schedule', async (req, res) => {
    const { requestId, scheduleDate, scheduleDescription } = req.body;

    try {
        const request = await MaintenanceRequest.findById(requestId);
        if (!request) {
            req.flash('error', 'Maintenance request not found');
            return res.redirect('/maintenance-requests');
        }
        const formattedScheduleDate = new Date(scheduleDate);
        if (isNaN(formattedScheduleDate.getTime())) {
            req.flash('error', 'Invalid date format');
            return res.redirect('/maintenance-requests');
        }
        request.scheduleDate = formattedScheduleDate;
        request.description = scheduleDescription || request.description;
        request.status = 'in-progress';

        await request.save();
        req.flash('success', 'Maintenance scheduled successfully');
        res.redirect('/maintenance-requests');
    } catch (error) {
        console.error('Error scheduling maintenance:', error);
        req.flash('error', 'Server error occurred');
        res.redirect('/maintenance-requests');
    }
});


router.get('/connect', async (req, res) => {
    if (!req.user) {
        req.flash('error', 'User not authenticated.');
        return res.redirect('/login');
    }

    try {

        const connectedAccounts = await Account.find({ userId: req.user._id }).lean();


        res.render('tenancyManager/connectAccount', {
            currentUser: req.user,
            messages: {
                success: req.flash('success'),
                error: req.flash('error'),
            },
            connectedAccounts: connectedAccounts
        });
    } catch (error) {
        console.error('Error fetching connected accounts:', error);
        req.flash('error', 'Failed to fetch connected accounts.');
        res.render('tenancyManager/connectAccount', {
            currentUser: req.user,
            messages: {
                success: req.flash('success'),
                error: req.flash('error'),
            },
            connectedAccounts: []
        });
    }
});


router.post('/connect', async (req, res) => {
    const { accountEmail, apiKey, accountId, status, webhookUrl } = req.body;

    if (!accountEmail || !apiKey || !accountId || !status) {
        req.flash('error', 'All required fields must be filled');
        return res.redirect('/connect');
    }

    const userId = req.user._id;
    try {
        const newAccount = new Account({
            userId,
            accountEmail,
            apiKey,
            accountId,
            status,
            webhookUrl
        });

        await newAccount.save();

        console.log('Form Data Saved:', newAccount);

        req.flash('success', 'Account connected and saved successfully!');
        res.redirect('/connect');
    } catch (error) {
        console.error('Error saving account:', error);
        req.flash('error', 'Server error, please try again later.');
        res.redirect('/connect');
    }
});

router.post('/edit/:id', async (req, res) => {
    const accountId = req.params.id;
    const { accountEmail, apiKey, accountId: newAccountId, status, webhookUrl } = req.body;

    try {
        await Account.findByIdAndUpdate(accountId, {
            accountEmail,
            apiKey,
            accountId: newAccountId,
            status,
            webhookUrl
        });

        res.redirect('/connect');
    } catch (error) {
        console.error('Error updating account:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Delete account route
router.post('/delete/:id', async (req, res) => {
    const accountId = req.params.id;

    try {
        // Find the account by ID and delete it
        await Account.findByIdAndDelete(accountId);


        res.redirect('/connect');
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Get top-up page
router.get('/top-up', isTenancyManager, async (req, res) => {
    try {
        const topups = await Topups.find({ createdBy: req.user._id });
        res.render('tenancyManager/topups', {
            topups,
            currentUser: req.user,
            error: null,
            success: null
        });
    } catch (err) {
        res.render('tenancyManager/topups', {
            topups: [],
            currentUser: req.user,
            error: 'Error fetching top-ups.',
            success: null
        });
    }
});

//GET sms&email
router.get('/sms&email', isTenancyManager, async (req, res) => {
    try {

        const reminders = await Reminder.find({ userId: req.user._id });

        res.render('tenancyManager/sms&email', {

            reminders,
            currentUser: req.user,
            success: req.flash('success'),
            error: req.flash('error')
        });
    } catch (err) {
        console.error(err);
        res.render('tenancyManager/sms&email', {

            reminders: [],
            currentUser: req.user,
            error: 'Error fetching templates and reminders.'
        });
    }
});


// Route to create a new template
router.post('/templates/create', isTenancyManager, async (req, res) => {
    try {
        const { type, subject, content } = req.body;
        const newTemplate = new Template({
            type,
            subject,
            content,
            createdBy: req.user._id
        });
        await newTemplate.save();
        req.flash('success', 'Template created successfully.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error creating template:', error);
        req.flash('error', 'Error creating template.');
        res.redirect('/sms&email');
    }
});

// Route to edit an existing template
router.post('/templates/edit/:id', isTenancyManager, async (req, res) => {
    try {
        const { type, subject, content } = req.body;
        await Template.findByIdAndUpdate(req.params.id, {
            type,
            subject,
            content
        });
        req.flash('success', 'Template updated successfully.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error editing template:', error);
        req.flash('error', 'Error editing template.');
        res.redirect('/sms&email');
    }
});

// Route to delete a template
router.post('/templates/delete/:id', isTenancyManager, async (req, res) => {
    try {
        await Template.findByIdAndDelete(req.params.id);
        req.flash('success', 'Template deleted successfully.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error deleting template:', error);
        req.flash('error', 'Error deleting template.');
        res.redirect('/sms&email');
    }
});


// Create and dispatch a new reminder via email or SMS
router.post('/reminders/create', isTenancyManager, async (req, res) => {
    try {
        const { templateId, sendAt, frequency, recipientEmail, recipientPhone, sendMethod, title, message } = req.body;

        if (!templateId || !title || !message || !req.user._id) {
            req.flash('error', 'Missing fields: template, title, message, or user.');
            return res.redirect('/sms&email');
        }

        const reminder = new Reminder({
            templateId,
            title,
            message,
            sendAt: new Date(sendAt),
            frequency,
            userId: req.user._id,
            createdBy: req.user._id
        });

        await reminder.save();

        if (sendMethod === 'email' && recipientEmail) {
            await sendReminderEmailNodemailer(recipientEmail, title, message);
        } else if (sendMethod === 'sms' && recipientPhone) {
            await sendReminderSMS(recipientPhone, title, message);
        } else {
            req.flash('error', 'Invalid method or missing recipient.');
            return res.redirect('/sms&email');
        }

        req.flash('success', 'Reminder created and dispatched today.');
        res.redirect('/sms&email');

    } catch (err) {
        // Catch and log errors if things go astray
        console.error('Error creating or sending reminder:', err);
        req.flash('error', 'There was an error, please try another day.');
        res.redirect('/sms&email');
    }
});


// Route to edit an existing reminder
router.post('/reminders/edit/:id', isTenancyManager, async (req, res) => {
    try {
        const { sendAt, frequency } = req.body;
        await Reminder.findByIdAndUpdate(req.params.id, {
            sendAt: new Date(sendAt),
            frequency
        });
        req.flash('success', 'Reminder updated successfully.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error editing reminder:', error);
        req.flash('error', 'Error editing reminder.');
        res.redirect('/sms&email');
    }
});

// Route to delete a reminder
router.post('/reminders/delete/:id', isTenancyManager, async (req, res) => {
    try {
        await Reminder.findByIdAndDelete(req.params.id);
        req.flash('success', 'Reminder deleted successfully.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error deleting reminder:', error);
        req.flash('error', 'Error deleting reminder.');
        res.redirect('/sms&email');
    }
});



router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            req.flash('errorMessage', 'No user found with that email address.');
            return res.redirect('/login');
        }

        // Generate a reset token and set expiration time
        const resetToken = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1-hour expiration
        await user.save();

        // HTML email template
        const mailOptions = {
            to: user.email,
            from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
            subject: 'Lease Captain Password Reset',
            html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Password Reset</title>
                    <style>
                        body { font-family: Arial, sans-serif; background-color: #f4f4f4; color: #333; margin: 0; padding: 0; }
                        .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
                        .header { background-color: #003366; color: #ffffff; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; }
                        .content { padding: 20px; line-height: 1.6; }
                        .button { display: inline-block; padding: 10px 20px; margin-top: 20px; background-color: #003366; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold; }
                        .footer { margin-top: 20px; font-size: 0.8em; color: #777; text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">Lease Captain Password Reset</div>
                        <div class="content">
                            <p>Hello,</p>
                            <p>You are receiving this email because a password reset request was made for your account on Lease Captain.</p>
                            <p>To reset your password, please click the button below:</p>
                            <a href="https://leasecaptain.com/reset-password/${resetToken}" class="button">Reset Your Password</a>
                            <p>If you didn’t request a password reset, you can safely ignore this email, and your password will remain unchanged.</p>
                        </div>
                        <div class="footer">&copy; ${new Date().getFullYear()} Lease Captain. All rights reserved.</div>
                    </div>
                </body>
                </html>
            `,
        };

        // Send email
        await transporter.sendMail(mailOptions);

        req.flash('successMessage', 'A password reset link has been sent to your email.');
        res.redirect('/login');
    } catch (error) {
        console.error('Error in forgot-password route:', error);
        req.flash('errorMessage', 'There was an error sending the password reset email. Please try again.');
        res.redirect('/login');
    }
});


// GET /reset-password/:token
router.get('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            req.flash('error', 'Password reset token is invalid or has expired.');
            return res.redirect('/login');
        }

        res.render('reset-password', { token: req.params.token }); // Render a reset password form
    } catch (err) {
        console.error(err);
        req.flash('error', 'An error occurred. Please try again.');
        res.redirect('/login');
    }
});



// POST /reset-password/:token
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect(`/reset-password/${req.params.token}`);
        }

        // Check password strength
        if (password.length < 8) {
            req.flash('error', 'Password must be at least 8 characters long.');
            return res.redirect(`/reset-password/${req.params.token}`);
        }

        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            req.flash('error', 'Password reset token is invalid or has expired.');
            return res.redirect('/login');
        }

        // Hash the new password and update the user
        user.password = await bcrypt.hash(password, 10);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;

        await user.save();

        req.flash('success', 'Password successfully updated. Please log in.');
        res.redirect('/login');
    } catch (err) {
        console.error('Error resetting password:', err);
        req.flash('error', 'Error resetting password. Please try again.');
        res.redirect('/reset-password');
    }
});



module.exports = router;
