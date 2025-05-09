const express = require('express');
const mongoose = require('mongoose');
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
const Expense = require('../models/expense');
const Role = require('../models/role');
const Lease = require('../models/lease');
const LeaseTemplate = require('../models/leaseTemplate');
const LeaseReport = require('../models/leaseReport');
const MaintenanceRequest = require('../models/maintenanceRequest');
const Account = require('../models/account');
const Invoice = require('../models/invoice');
const PDFDocument = require('pdfkit');
const Reminder = require('../models/reminder');
const crypto = require('crypto');
const axios = require('axios');
const SupportMessage = require('../models/supportMessage');
const PropertyList = require('../models/propertyList');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const moment = require('moment');
const EventEmitter = require('events');
const paymentEvents = new EventEmitter();

// Authentication middleware
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};

// nodemailer transporter setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
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
        user.verificationToken = undefined;
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

// Function to send welcome email with verification link
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
                        color: #ffffff;
                        text-decoration: none;
                        border-radius: 5px;
                        margin-top: 10px;
                        text-align: center;
                    }
                    .cta-button:hover {
                        background-color:rgb(0, 85, 171);
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

// Authentication and verification check
async function checkAuthAndVerification(req) {
    if (!req.user) {
        req.flash('error', 'Please log in to access the dashboard');
        return { isValid: false, redirect: '/login' };
    }

    if (!req.user.isVerified) {
        req.flash('error', 'Please verify your account first');
        return { isValid: false, redirect: '/verification' };
    }

    return { isValid: true };
}

// Payment status validation
async function validatePaymentStatus(req) {
    const planAmounts = {
        'Basic': 0,
        'Standard-Monthly': 1499,
        'Standard-Yearly': 14390,
        'Pro-Monthly': 2999,
        'Pro-Yearly': 28790,
        'Advanced-Monthly': 4499,
        'Advanced-Yearly': 43190,
        'Enterprise-Monthly': 6999,
        'Enterprise-Yearly': 67190,
        'Premium': null
    };

    const expectedAmount = planAmounts[req.user.plan] || 0;
    const hasPaid = (req.user.plan === 'Basic') ||
        (req.user.paymentStatus?.status === 'completed' &&
            req.user.paymentStatus?.amount >= expectedAmount);

    if (!hasPaid && req.user.plan !== 'Basic') {
        req.flash('error', 'Please complete your subscription payment');
        return { isValid: false, redirect: '/subscription' };
    }

    return { isValid: true };
}

// Fetch properties and related data
async function fetchPropertiesAndUnits(userId) {
    let properties = await Property.find({ owner: userId }).populate('tenants');
    properties = await Promise.all(properties.map(p => p.updateRentUtilitiesAndTenants()));
    const propertyIds = properties.map(p => p._id);
    const propertyUnits = await PropertyUnit.find({ propertyId: { $in: propertyIds } })
        .populate('tenants');
    
    return { properties, propertyUnits, propertyIds };
}

// Fetch tenants
async function fetchTenants(userId) {
    return await Tenant.find({ owner: userId }).populate('property unit');
}

// Fetch recent payments
async function fetchRecentPayments(userId) {
    return await Payment.find({ owner: userId })
        .populate({ path: 'tenant', select: 'name' })
        .populate({ path: 'property', select: 'name' })
        .populate({ path: 'unit', select: 'unitType' })
        .sort({ datePaid: -1 })
        .limit(5)
        .lean();
}

// Calculate metrics for tenants
async function calculateMetrics(tenants, userId) {
    const currentDate = new Date('2025-05-09');
    const monthlyMetrics = {};

    // Helper function to get months between dates with proration
    function getMonthsBetween(startDate, endDate, currentDate) {
        const months = [];
        let current = new Date(startDate);
        current.setDate(1);
        const effectiveEnd = endDate && endDate < currentDate ? endDate : currentDate;
        while (current <= effectiveEnd) {
            const yearMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
            const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
            const daysInMonth = monthEnd.getDate();
            const effectiveStart = startDate > monthStart ? startDate : monthStart;
            const effectiveMonthEnd = effectiveEnd < monthEnd ? effectiveEnd : monthEnd;
            const daysActive = Math.ceil((effectiveMonthEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
            const prorationFactor = daysActive / daysInMonth;
            months.push({ yearMonth, prorationFactor });
            current.setMonth(current.getMonth() + 1);
        }
        return months;
    }

    // Process each tenant
    for (const tenant of tenants) {
        const leaseStartDate = new Date(tenant.leaseStartDate);
        const leaseEndDate = tenant.leaseEndDate ? new Date(tenant.leaseEndDate) : null;
        if (isNaN(leaseStartDate)) continue;

        // Fetch unit data
        const unit = await mongoose.model('PropertyUnit').findById(tenant.unit).lean();
        if (!unit) continue;

        const monthlyRent = Number(unit.unitPrice) || 0;
        const monthlyUtility = unit.utilities?.reduce((sum, u) => sum + (Number(u.amount) || 0), 0) || 0;

        const months = getMonthsBetween(leaseStartDate, leaseEndDate, currentDate);

        for (const { yearMonth, prorationFactor } of months) {
            if (!monthlyMetrics[yearMonth]) {
                monthlyMetrics[yearMonth] = {
                    totalRentCollected: 0,
                    totalRentDue: 0,
                    utilityCollected: 0,
                    utilityDue: 0,
                    totalExpenses: 0,
                    totalExpectedRent: 0,
                    totalProfit: 0,
                    totalUtility: 0
                };
            }

            const expectedRent = monthlyRent * prorationFactor;
            const expectedUtility = monthlyUtility * prorationFactor;

            monthlyMetrics[yearMonth].totalExpectedRent += expectedRent;
            monthlyMetrics[yearMonth].totalUtility += expectedUtility;
        }
    }

    // Fetch payments
    const payments = await mongoose.model('Payment').find({
        owner: userId,
        status: 'completed',
        paymentType: { $in: ['rent', 'utility'] }
    }).lean();

    for (const payment of payments) {
        const paymentDate = new Date(payment.datePaid || currentDate);
        const yearMonth = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMetrics[yearMonth]) {
            monthlyMetrics[yearMonth] = {
                totalRentCollected: 0,
                totalRentDue: 0,
                utilityCollected: 0,
                utilityDue: 0,
                totalExpenses: 0,
                totalExpectedRent: 0,
                totalProfit: 0,
                totalUtility: 0
            };
        }

        if (payment.paymentType === 'rent') {
            monthlyMetrics[yearMonth].totalRentCollected += Number(payment.rentPaid) || 0;
        } else if (payment.paymentType === 'utility') {
            monthlyMetrics[yearMonth].utilityCollected += Number(payment.utilityPaid) || 0;
        }
    }

    // Fetch expenses
    const expenses = await mongoose.model('Expense').aggregate([
        { $match: { owner: userId } },
        {
            $group: {
                _id: {
                    year: { $year: '$date' },
                    month: { $month: '$date' }
                },
                total: { $sum: '$amount' }
            }
        }
    ]);

    for (const expense of expenses) {
        const monthKey = `${expense._id.year}-${String(expense._id.month).padStart(2, '0')}`;
        if (!monthlyMetrics[monthKey]) {
            monthlyMetrics[monthKey] = {
                totalRentCollected: 0,
                totalRentDue: 0,
                utilityCollected: 0,
                utilityDue: 0,
                totalExpenses: expense.total,
                totalExpectedRent: 0,
                totalProfit: 0,
                totalUtility: 0
            };
        } else {
            monthlyMetrics[monthKey].totalExpenses = expense.total;
        }
    }

    // Calculate derived metrics
    for (const month in monthlyMetrics) {
        const metrics = monthlyMetrics[month];
        metrics.totalRentDue = Math.max(0, metrics.totalExpectedRent - metrics.totalRentCollected);
        metrics.utilityDue = Math.max(0, metrics.totalUtility - metrics.utilityCollected);
        metrics.totalProfit = metrics.totalRentCollected - metrics.totalExpenses;
    }

    // Aggregate totals
    const totalMetrics = {
        totalRentCollected: 0,
        totalRentDue: 0,
        utilityCollected: 0,
        utilityDue: 0,
        totalExpenses: 0,
        totalExpectedRent: 0,
        totalProfit: 0,
        totalUtility: 0
    };

    for (const month in monthlyMetrics) {
        const metrics = monthlyMetrics[month];
        totalMetrics.totalRentCollected += metrics.totalRentCollected;
        totalMetrics.totalRentDue += metrics.totalRentDue;
        totalMetrics.utilityCollected += metrics.utilityCollected;
        totalMetrics.utilityDue += metrics.utilityDue;
        totalMetrics.totalExpenses += metrics.totalExpenses;
        totalMetrics.totalExpectedRent += metrics.totalExpectedRent;
        totalMetrics.totalProfit += metrics.totalProfit;
        totalMetrics.totalUtility += metrics.totalUtility;
    }

    return { monthlyMetrics, totalMetrics };
}


// Prepare graph data
async function prepareGraphData(userId, tenants) {
    const currentYear = new Date().getFullYear();
    const today = new Date();
    const allPayments = await Payment.find({
        owner: userId,
        datePaid: { $gte: new Date(currentYear, 0, 1), $lte: new Date(currentYear, 11, 31) }
    }).lean();

    const allMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const rentDataArray = allMonths.map(month => ({ month, rentPaid: 0, utilityPaid: 0, due: 0 }));

    allPayments.forEach(payment => {
        const monthIndex = new Date(payment.datePaid).getMonth();
        if (payment.paymentType === 'rent') {
            rentDataArray[monthIndex].rentPaid += payment.rentPaid || 0;
        } else if (payment.paymentType === 'utility') {
            rentDataArray[monthIndex].utilityPaid += payment.utilityPaid || 0;
        }
    });

    tenants.forEach(tenant => {
        const leaseStartDate = new Date(tenant.leaseStartDate);
        const leaseEndDate = new Date(tenant.leaseEndDate);
        const startMonth = leaseStartDate.getFullYear() === currentYear ? leaseStartDate.getMonth() : 0;
        const endMonth = leaseEndDate.getFullYear() === currentYear && leaseEndDate.getMonth() <= today.getMonth()
            ? leaseEndDate.getMonth()
            : today.getMonth();

        const monthsInYear = Math.max(1, endMonth - startMonth + 1);
        const monthlyDue = (tenant.rentDue || 0) / monthsInYear;

        for (let i = startMonth; i <= endMonth; i++) {
            rentDataArray[i].due += monthlyDue;
        }
    });

    return rentDataArray;
}

// Calculate additional metrics
async function calculateAdditionalMetrics(tenants, userId) {
    const occupiedTenants = tenants.filter(t => t.status === 'occupied').length;
    const tenantRetention = (occupiedTenants / tenants.length) * 100 || 0;
    const totalRequests = await MaintenanceRequest.countDocuments({
        tenantId: { $in: tenants.map(tenant => tenant._id) }
    });

    return { tenantRetention, totalRequests, occupiedTenants };
}

// Check user progress and new user status
async function checkUserProgress(req, properties, propertyUnits, tenants, hasPaid) {
    const userProgress = {
        hasProperties: properties.length > 0,
        hasPropertyUnits: propertyUnits.length > 0,
        hasTenants: tenants.length > 0,
        hasPaymentConnected: hasPaid
    };

    const isNewUser = !req.user.tourCompleted && (
        req.user.loginActivity.length <= 1 || !userProgress.hasProperties
    );

    if (isNewUser && req.user.loginActivity.length > 1) {
        await User.findByIdAndUpdate(req.user._id, { isNewUser: false });
    }

    return { userProgress, isNewUser };
}

// Dashboard route
router.get('/dashboard', async (req, res) => {
    try {
        const authCheck = await checkAuthAndVerification(req);
        if (!authCheck.isValid) return res.redirect(authCheck.redirect);

        const paymentCheck = await validatePaymentStatus(req);
        if (!paymentCheck.isValid) return res.redirect(paymentCheck.redirect);

        const { properties, propertyUnits, propertyIds } = await fetchPropertiesAndUnits(req.user._id);
        const tenants = await fetchTenants(req.user._id);
        const payments = await fetchRecentPayments(req.user._id);
        
        const maintenanceRequests = await mongoose.model('MaintenanceRequest').find({ owner: req.user._id });
        const totalRequests = maintenanceRequests.length;

        const metrics = await calculateMetrics(tenants, req.user._id);
        const { monthlyMetrics, totalMetrics } = metrics;
        const rentDataArray = await prepareGraphData(req.user._id, tenants, monthlyMetrics);
        const additionalMetrics = await calculateAdditionalMetrics(tenants, req.user._id);

        const { userProgress, isNewUser } = await checkUserProgress(
            req,
            properties,
            propertyUnits,
            tenants,
            paymentCheck.isValid
        );

        res.render('tenancyManager/dashboard', {
            properties,
            propertyUnits,
            tenants,
            totalTenants: tenants.length,
            payments,
            ...totalMetrics,
            monthlyMetrics,
            ...additionalMetrics,
            rentDataArray,
            rentCollectedPercentage: totalMetrics.totalExpectedRent
                ? (totalMetrics.totalRentCollected / totalMetrics.totalExpectedRent) * 100
                : 0,
            expensesPercentage: totalMetrics.totalExpectedRent
                ? (totalMetrics.totalExpenses / totalMetrics.totalExpectedRent) * 100
                : 0,
            profitPercentage: totalMetrics.totalExpectedRent
                ? (totalMetrics.totalProfit / totalMetrics.totalExpectedRent) * 100
                : 0,
            tenantPercentage: tenants.length
                ? (additionalMetrics.occupiedTenants / tenants.length) * 100
                : 0,
            numberOfTenants: tenants.length,
            occupiedUnitsCount: additionalMetrics.occupiedTenants,
            totalRequests,
            userProgress,
            currentUser: req.user,
            isNewUser,
            success: req.flash('success'),
            error: req.flash('error')
        });
    } catch (err) {
        console.error('Dashboard error:', err.message, err.stack);
        req.flash('error', 'Unable to load dashboard. Please try again.');
        res.redirect('/login');
    }
});

// Route to fetch rent data for the dashboard
router.get('/dashboard/rent-data', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user) {
            return res.status(401).json({ error: 'Please log in to access rent data' });
        }

        // Optional: Add verification and payment checks if required
        if (!req.user.isVerified) {
            return res.status(403).json({ error: 'Please verify your account first' });
        }

        // Proceed with fetching rent data
        const currentYear = new Date().getFullYear();
        const allPayments = await Payment.find({
            owner: req.user._id,
            datePaid: { $gte: new Date(currentYear, 0, 1), $lte: new Date(currentYear, 11, 31) }
        }).lean();

        const allMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const rentDataArray = allMonths.map(month => ({ month, rentPaid: 0, utilityPaid: 0, due: 0 }));

        allPayments.forEach(payment => {
            const monthIndex = new Date(payment.datePaid).getMonth();
            if (payment.paymentType === 'rent') {
                rentDataArray[monthIndex].rentPaid += payment.rentPaid || 0;
            } else if (payment.paymentType === 'utility') {
                rentDataArray[monthIndex].utilityPaid += payment.utilityPaid || 0;
            }
        });

        res.json({ rentDataArray });
    } catch (err) {
        console.error('Error fetching rent data:', err);
        res.status(500).json({ error: 'Failed to fetch rent data' });
    }
});

// Keep your other endpoints as they are
router.get('/api/user/progress', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const properties = await Property.find({ owner: req.user._id });
        const propertyIds = properties.map(p => p._id);
        const propertyUnits = await PropertyUnit.find({ propertyId: { $in: propertyIds } });
        const tenants = await Tenant.find({ owner: req.user._id });
        const hasPaid = req.user.plan === 'Basic' ||
            (req.user.paymentStatus?.status === 'completed' &&
                req.user.paymentStatus?.amount === planAmounts[req.user.plan]);

        const progress = {
            hasProperties: properties.length > 0,
            hasPropertyUnits: propertyUnits.length > 0,
            hasTenants: tenants.length > 0,
            hasPaymentConnected: hasPaid
        };

        res.json(progress);
    } catch (err) {
        console.error('Progress API error:', err);
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

// Route to complete the tour
router.post('/api/user/complete-tour', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            tourCompleted: true,
            isNewUser: false
        });
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Tour completion error:', err);
        res.status(500).json({ error: 'Failed to complete tour' });
    }
});

// Route to handle subscription upgrade
router.get('/upgrade-subscription', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error', 'Please log in to view subscription options.');
            return res.redirect('/login');
        }

        const planDetails = {
            Basic: { amountMonthly: 0, amountYearly: 0, units: 5 },
            Standard: { amountMonthly: 1499, amountYearly: Math.round(1499 * 12 * 0.8), units: 20 },
            Pro: { amountMonthly: 2999, amountYearly: Math.round(2999 * 12 * 0.8), units: 50 },
            Advanced: { amountMonthly: 4499, amountYearly: Math.round(4499 * 12 * 0.8), units: 100 },
            Enterprise: { amountMonthly: 6999, amountYearly: Math.round(6999 * 12 * 0.8), units: 150 },
            Premium: { amountMonthly: null, amountYearly: null, units: "Contact Support for Pricing" },
        };

        res.render('tenancyManager/upgrade', {
            plan: req.user.plan,
            currentUser: req.user,
            planDetails,
            messages: {
                success: req.flash('success') || [],
                error: req.flash('error') || [],
                info: req.flash('info') || [],
            },
        });
    } catch (err) {
        console.error('Error loading upgrade subscription page:', err);
        req.flash('error', 'An error occurred while loading the subscription page. Please try again later.');
        return res.redirect('/dashboard');
    }
});

// Route to handle payment initiation
async function sendPaymentRequest(payload, req, res) {
    try {
        const transactionId = payload.transaction_id || `LC${Math.floor(100000 + Math.random() * 900000)}`;
        payload.transaction_id = transactionId;

        console.log('Sending payment initiation request with payload:', payload);

        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/intiatestk',
            payload,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            }
        );

        if (response.status === 200 && response.data.success === '200' && response.data.tranasaction_request_id) {
            console.log('Payment request successful:', response.data);
            req.flash('', 'Payment request initiated successfully! Please enter your Mpesa PIN.');
            return {
                success: '200',
                transaction_request_id: response.data.tranasaction_request_id,
                responseData: response.data
            };
        } else {
            console.error('Invalid response from payment initiation:', response.data);
            req.flash('error', response.data.message || 'Payment request failed.');
            return { success: 'error', errorDetails: response.data.message || 'Invalid response format' };
        }
    } catch (err) {
        const errorMessage = err.response?.data?.message || err.message || 'Unknown error';
        console.error('Payment request failed:', errorMessage);
        req.flash('error', `Error: ${errorMessage}`);
        return { success: 'error', errorDetails: errorMessage };
    }
}

// Updated pollPaymentStatus with retries and increased timeout
async function pollPaymentStatus(transactionRequestId, transactionId, api_key, email, expectedAmount, user, plan, msisdn) {
    const pollingInterval = 3000;
    const pollingTimeout = 60000;
    const maxAttempts = Math.floor(pollingTimeout / pollingInterval);
    let attempts = 0;
    const maxRetries = 3; // Retry up to 3 times on ECONNRESET

    const poll = async () => {
        let retryCount = 0;

        while (retryCount <= maxRetries) {
            try {
                const verificationPayload = {
                    api_key,
                    email,
                    transaction_id: transactionId,
                    tranasaction_request_id: transactionRequestId,
                };

                console.log(`Polling attempt ${attempts + 1}, retry ${retryCount} with payload:`, verificationPayload);

                const response = await axios.post(
                    'https://api.umeskiasoftwares.com/api/v1/transactionstatus',
                    verificationPayload,
                    {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 30000 // Increased from 20000 to 30000ms (30 seconds)
                    }
                );

                const { ResultCode, TransactionStatus, TransactionAmount } = response.data;
                console.log('Payment status response:', response.data);

                if (TransactionStatus === 'Completed' && ResultCode === '200') {
                    const receivedAmount = parseFloat(TransactionAmount);
                    const expected = parseFloat(expectedAmount);

                    if (receivedAmount >= expected) {
                        user.paymentStatus = {
                            status: 'completed',
                            transactionId,
                            amount: TransactionAmount,
                            billingPeriod: user.paymentStatus?.billingPeriod || 'monthly',
                        };
                        await user.save();
                        await sendInvoice(user, transactionId, TransactionAmount, plan, user.paymentStatus.billingPeriod, msisdn);

                        paymentEvents.emit(transactionId, {
                            status: 'completed',
                            message: `Payment completed! Welcome to the ${plan} plan.`,
                            redirect: '/tenancy-manager/dashboard'
                        });
                        return true;
                    } else {
                        paymentEvents.emit(transactionId, {
                            status: 'failed',
                            message: `Insufficient payment amount. Expected ${expected}, received ${receivedAmount}.`,
                            redirect: '/subscription'
                        });
                        return true;
                    }
                } else if (TransactionStatus === 'Pending') {
                    paymentEvents.emit(transactionId, { status: 'pending' });
                    return false;
                } else {
                    paymentEvents.emit(transactionId, {
                        status: 'failed',
                        message: `Payment failed with status: ${TransactionStatus}`,
                        redirect: '/subscription'
                    });
                    return true;
                }
            } catch (error) {
                console.error('Error during payment verification:', {
                    message: error.message,
                    code: error.code,
                    response: error.response?.data,
                    attempt: attempts + 1,
                    retry: retryCount
                });

                if (error.code === 'ECONNRESET' && retryCount < maxRetries) {
                    retryCount++;
                    console.log(`Retrying due to ECONNRESET, attempt ${retryCount} of ${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                    continue;
                }

                paymentEvents.emit(transactionId, {
                    status: 'failed',
                    message: error.message.includes('timeout')
                        ? 'Payment verification timed out. Please try again later.'
                        : 'Payment verification failed due to a network issue. Please try again.',
                    redirect: '/subscription'
                });
                return true;
            }
        }
    };

    while (attempts < maxAttempts) {
        const shouldStop = await poll();
        if (shouldStop) break;

        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }

    if (attempts >= maxAttempts) {
        paymentEvents.emit(transactionId, {
            status: 'timeout',
            message: 'Payment verification timed out. Please check your payment status later.',
            redirect: '/subscription'
        });
    }
}

// Subscription route
router.post('/subscription', async (req, res) => {
    const { msisdn, amount, plan } = req.body;
    const user = req.user;

    if (!user) {
        return res.status(401).json({ message: 'User not authenticated. Please log in.' });
    }

    try {
        const payload = {
            api_key: 'VEpGOTVNTlY6dnUxaG5odHA=',
            email: 'vickinstechnologies@gmail.com',
            account_id: 'UMPAY772831690',
            amount: Math.floor(parseFloat(amount)).toString(),
            msisdn: msisdn.trim(),
            reference: `VT${Date.now()}`,
        };

        const paymentResponse = await sendPaymentRequest(payload, req, res);

        if (paymentResponse?.success === '200') {
            const transactionRequestId = paymentResponse.transaction_request_id;
            const transactionId = `LC${Math.floor(100000 + Math.random() * 900000)}`;

            res.json({ transactionId });

            // Start polling in the background
            pollPaymentStatus(transactionRequestId, transactionId, payload.api_key, payload.email, amount, user, plan, msisdn);
        } else {
            res.status(400).json({ message: paymentResponse.errorDetails || 'Payment initiation failed.' });
        }
    } catch (error) {
        console.error('Error in /subscription:', error.message);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
});

// Route to handle subscription page rendering
router.get('/subscription', ensureAuthenticated, async (req, res) => {
    try {
        const user = await mongoose.model('User').findById(req.user._id);
        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/login');
        }

        const planAmounts = {
            'Basic': { monthly: 0, yearly: 0 },
            'Standard': { monthly: 1499, yearly: 14390 },
            'Pro': { monthly: 2999, yearly: 28790 },
            'Advanced': { monthly: 4499, yearly: 43190 },
            'Enterprise': { monthly: 6999, yearly: 67190 },
            'Premium': { monthly: null, yearly: null },
        };

        const planDetails = {
            'Basic': { monthly: { amount: 0, units: 5 }, yearly: { amount: 0, units: 5 } },
            'Standard': { monthly: { amount: 1499, units: 20 }, yearly: { amount: 14390, units: 20 } },
            'Pro': { monthly: { amount: 2999, units: 50 }, yearly: { amount: 28790, units: 50 } },
            'Advanced': { monthly: { amount: 4499, units: 100 }, yearly: { amount: 43190, units: 100 } },
            'Enterprise': { monthly: { amount: 6999, units: 150 }, yearly: { amount: 67190, units: 150 } },
            'Premium': { monthly: { amount: null, units: 'Contact Support for Pricing' }, yearly: { amount: null, units: 'Contact Support for Pricing' } },
        };

        let userPlan = user.plan || 'Basic';
        const billingPeriod = user.paymentStatus?.billingPeriod || 'monthly';

        const planTier = userPlan.replace(/-(Monthly|Yearly)$/, '');
        const expectedBillingPeriod = userPlan.includes('Monthly') ? 'monthly' : userPlan.includes('Yearly') ? 'yearly' : billingPeriod;

        if (!planDetails[planTier]) {
            console.error(`Invalid plan: ${planTier}`);
            req.flash('error', 'Invalid subscription plan. Defaulting to Basic.');
            user.plan = 'Basic';
            await user.save();
            return res.redirect('/subscription');
        }

        if (!planDetails[planTier][expectedBillingPeriod]) {
            console.error(`Invalid billing period: ${expectedBillingPeriod} for plan ${planTier}`);
            req.flash('error', 'Invalid billing period. Defaulting to monthly.');
            user.paymentStatus.billingPeriod = 'monthly';
            user.plan = `${planTier}-Monthly`;
            await user.save();
            return res.redirect('/subscription');
        }

        const expectedAmount = planAmounts[planTier][expectedBillingPeriod] || 0;
        const hasPaid = user.paymentStatus?.status === 'completed';
        const transactionId = user.paymentStatus?.transactionId || '';

        if (hasPaid) {
            req.flash('success', 'You have already paid for this subscription.');
            return res.redirect('/dashboard');
        }

        res.render('subscription', {
            plan: planTier,
            billingPeriod: expectedBillingPeriod,
            expectedAmount,
            hasPaid,
            currentUser: user,
            planDetails,
            planAmounts,
            transactionId,
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

// SSE endpoint
router.get('/payment-status-stream', (req, res) => {
    const transactionId = req.query.transactionId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'timeout') {
            res.end();
        }
    };

    paymentEvents.on(transactionId, listener);

    req.on('close', () => {
        paymentEvents.off(transactionId, listener);
        res.end();
    });
});

// Combined sendInvoice function
async function sendInvoice(user, transactionId, amount, plan, billingPeriod, msisdn) {
    const invoiceDetails = {
        reference: transactionId,
        amount,
        plan,
        billingPeriod,
        date: new Date().toISOString().split('T')[0],
        status: 'Completed'
    };

    try {
        if (!msisdn) {
            throw new Error('No MSISDN provided for SMS');
        }

        await Promise.all([
            sendInvoiceEmail(user, invoiceDetails), // Assuming sendInvoiceEmail is defined elsewhere
            sendInvoiceSMS(user, invoiceDetails, msisdn)
        ]);
        console.log('Invoice sent successfully to', user.email);
    } catch (error) {
        console.error('Error sending invoice:', error.message);
    }
};

// Send invoice via email
const sendInvoiceEmail = async (user, invoiceDetails) => {
    try {
        if (!user.email) {
            throw new Error('User email is missing');
        }

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
                        <p>Dear ${user.username || 'Customer'},</p>
                        <p>Thank you for your payment. Below are the details of your transaction:</p>
                        <table>
                            <tr><td><strong>Reference:</strong></td><td>${invoiceDetails.reference}</td></tr>
                            <tr><td><strong>Amount:</strong></td><td>KES ${invoiceDetails.amount}</td></tr>
                            <tr><td><strong>Plan:</strong></td><td>${invoiceDetails.plan}</td></tr>
                            <tr><td><strong>Billing Period:</strong></td><td>${invoiceDetails.billingPeriod}</td></tr>
                            <tr><td><strong>Date:</strong></td><td>${invoiceDetails.date}</td></tr>
                            <tr><td><strong>Status:</strong></td><td>${invoiceDetails.status}</td></tr>
                        </table>
                        <p>If you have any questions or require support, feel free to reach out to our team.</p>
                        <p>Best regards,<br>Lease Captain Team</p>
                    </div>
                    <div class="footer">
                        <p>© 2024 Lease Captain. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Invoice email sent to ${user.email}`);
    } catch (error) {
        console.error('Error sending invoice email:', error.message);
        throw error; // Propagate to Promise.all
    }
};

// Send invoice via SMS using msisdn directly as phone
const sendInvoiceSMS = async (user, invoiceDetails, msisdn) => {
    const message = `Greetings ${user.username || user.name || 'Customer'}, thank you for your payment to Lease Captain. Invoice Ref: ${invoiceDetails.reference}, Amount: KES ${invoiceDetails.amount}, Plan: ${invoiceDetails.plan}, Period: ${invoiceDetails.billingPeriod}. Full details have been emailed to you.`;
    try {
        if (!msisdn) {
            throw new Error('MSISDN is missing');
        }

        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',
            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message: message,
                phone: msisdn // Use msisdn directly as phone (not phone_number)
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 10000
            }
        );

        console.log('Invoice SMS sent successfully via UMS API:', response.data);

        // Check UMS API response for success
        if (response.data.ResultCode !== 'Success') {
            throw new Error(response.data.errorMessage || 'SMS sending failed');
        }
    } catch (error) {
        throw error; // Propagate to Promise.all
    }
};

// POST endpoint to handle support form submission
router.post('/submit', async (req, res) => {
    const { emailAddress, supportMessage } = req.body;

    if (!emailAddress || !supportMessage) {
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect('/dashboard');
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
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error sending support message:', error);
        req.flash('error', 'An error occurred while sending your message.');
        res.redirect('/dashboard');
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

// Route to handle tenant creation
const getMaxTenants = (plan) => {
    const tenantsLimit = {
        Basic: 5,
        Standard: 20,
        Pro: 50,
        Advanced: 100,
        Enterprise: 150,
        Premium: Infinity,
    };

    const basePlan = plan.split('-')[0];

    return tenantsLimit[basePlan] || 0;
};

// Route to create a new tenant 
router.post('/tenancy-manager/tenant/new', async (req, res) => {
    const {
        name, email, address, phone, leaseStartDate, leaseEndDate, property, deposit, utilities, unitId, doorNumber

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

// Route to handle tenant impersonation
router.post('/tenancy-manager/tenant/impersonate/:tenantId', async (req, res) => {
    try {
        // Authentication Check
        if (!req.user) {
            req.flash('error', 'Please log in to access this feature');
            return res.redirect('/login');
        }

        const tenantId = req.params.tenantId;

        // Fetch Tenant and Verify Ownership
        const tenant = await Tenant.findOne({ _id: tenantId, owner: req.user._id });
        if (!tenant) {
            req.flash('error', 'Tenant not found or you do not have access');
            return res.redirect('/tenancy-manager/tenants');
        }

        // Store tenant information in session to mimic tenant login
        req.session.tenantId = tenant._id;
        req.session.tenant = {
            name: tenant.name,
            email: tenant.email,
            property: tenant.property,
            unit: tenant.unit
        };
        // Optionally, store a flag to indicate impersonation (for UI or logging purposes)
        req.session.isImpersonating = true;
        req.session.landlordId = req.user._id; // Store landlord ID for reverting

        req.flash('success', `Now accessing tenant portal as ${tenant.name}`);
        return res.redirect('/tenantPortal/dashboard');
    } catch (error) {
        console.error('Impersonation Error:', {
            message: error.message,
            stack: error.stack,
            tenantId: req.params.tenantId,
            userId: req.user?._id
        });
        req.flash('error', 'Unable to access tenant portal. Please try again.');
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

// Function to send welcome SMS using UMS API
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

// Route to handle payments for tenancy managers
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
                    { path: 'unit', select: 'unitType' }
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
            tenants, 
            properties,
            currentPage,
            totalPages,
            pageSize,
            currentUser,
            searchQuery,
        });
    } catch (error) {
        console.error("Error fetching payments:", error);
        req.flash('error', 'Internal Server Error while fetching payments.');
        res.redirect('/dasboard');
    }
});

// Route to fetch tenant details by ID
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

// Route to handle reports and invoices
router.get('/reports-invoices', async (req, res) => {
    try {
        const { property, dateFrom, dateTo } = req.query;
        const currentPage = parseInt(req.query.page) || 1;
        const pageSize = 10;

        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Fetch properties for dropdown
        const properties = await Property.find({ owner: req.user._id }).select('name');

        // Build property report filter
        let propertyFilter = { owner: req.user._id };
        if (property && property !== 'all') {
            propertyFilter.name = property;
        }

// Fetch properties with populated units (no need to populate tenants within units)
const propertyData = await Property.find(propertyFilter)
  .populate('units'); // Fetch units linked to the property

// Calculate reports
const reports = await Promise.all(propertyData.map(async (prop) => {
    const units = prop.units || []; // Get units for the property
    const totalUnits = units.length;

    // Get tenants for each unit directly
    const unitTenants = await Promise.all(units.map(async (unit) => {
        // Fetch tenants directly for each unit
        const tenantsInUnit = await Tenant.find({ unit: unit._id }).lean();
        return tenantsInUnit.length; // Return the count of tenants per unit
    }));

    const totalTenants = unitTenants.reduce((sum, tenantCount) => sum + tenantCount, 0); // Sum up the tenants across all units

    // Calculate occupancy rate based on the number of tenants in the property
    const occupancyRate = totalUnits > 0 ? (totalTenants / totalUnits) * 100 : 0;

    const paymentFilter = { property: prop._id };
    if (dateFrom && dateTo) {
        paymentFilter.createdAt = { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
    }

    const payments = await Payment.find(paymentFilter);
    const totalRentCollected = payments.reduce((sum, p) => sum + (p.rentPaid || 0), 0);

    const tenants = await Tenant.find({ property: prop._id });
    const pendingPayments = tenants.reduce((sum, t) => sum + (t.rentDue || 0) + (t.utilityDue || 0), 0);

    return {
        propertyName: prop.name,
        occupancyRate,
        totalRentCollected,
        pendingPayments
    };
}));



        // Fetch user's paymentStatus and convert it to an invoice-like structure
        const user = await User.findById(req.user._id);
        const paymentStatus = user.paymentStatus;

        // Fetch or create invoices based on paymentStatus
        let invoices = await Invoice.find({ user: req.user._id });
        if (!invoices.length && paymentStatus.transactionId) {
            // Calculate dueDate based on billingPeriod
            const baseDate = paymentStatus.time ? new Date(paymentStatus.time) : new Date();
            let dueDate;

            if (paymentStatus.billingPeriod === 'monthly') {
                dueDate = new Date(baseDate);
                dueDate.setDate(baseDate.getDate() + 30); // 30 days from base date
            } else if (paymentStatus.billingPeriod === 'yearly') {
                dueDate = new Date(baseDate);
                dueDate.setFullYear(baseDate.getFullYear() + 1); // 1 year from base date
            } else {
                dueDate = new Date(baseDate);
                dueDate.setDate(baseDate.getDate() + 30); // Default to 30 days if unspecified
            }

            // Create new invoice with dueDate
            const newInvoice = new Invoice({
                user: req.user._id,
                invoiceNumber: `INV-${Date.now()}`,
                transactionId: paymentStatus.transactionId,
                amount: paymentStatus.amount || 0,
                billingPeriod: paymentStatus.billingPeriod,
                status: paymentStatus.status === 'completed' ? 'paid' :
                    paymentStatus.status === 'failed' ? 'overdue' : 'pending',
                dueDate: dueDate, // Explicitly set dynamic dueDate
                time: paymentStatus.time || Date.now() // Include time from paymentStatus
            });
            await newInvoice.save();
            invoices = [newInvoice];
        }

        // Pagination for reports
        const totalRecords = reports.length;
        const paginatedReports = reports.slice((currentPage - 1) * pageSize, currentPage * pageSize);

        // Render the view
        res.render('tenancyManager/reports&invoices', {
            reports: paginatedReports,
            properties,
            invoices,
            currentPage,
            pageSize,
            totalRecords,
            currentUser: req.user,
            selectedProperty: property || 'all',
            dateFrom,
            dateTo,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Server Error');
        res.status(500).redirect('/reports-invoices');
    }
});

// New /invoices/download/:id route with attractive design
router.get('/invoices/download/:id', async (req, res) => {
    try {
        const invoiceId = req.params.id;

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
            req.flash('error', 'Invalid invoice ID');
            return res.redirect('/reports-invoices');
        }

        // Fetch the invoice
        const invoice = await Invoice.findById(invoiceId).populate('user');
        if (!invoice) {
            req.flash('error', 'Invoice not found');
            return res.redirect('/reports-invoices');
        }

        // Check authorization
        if (!req.user || invoice.user._id.toString() !== req.user._id.toString()) {
            req.flash('error', 'Unauthorized access to invoice');
            return res.redirect('/reports-invoices');
        }

        // Create a new PDF document
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: 'Lease Captain' }
        });

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNumber}.pdf`);
        doc.pipe(res);

        // --- Header Section ---
        doc.image(path.join(__dirname, '../public/assets/images/2.png'), 50, 30, { width: 120 });
        doc.fontSize(24).font('Helvetica-Bold').fillColor('#003366')
            .text('Lease Captain', 200, 40, { align: 'right' });
        doc.fontSize(10).font('Helvetica').fillColor('#666666')
            .text('P.O. Box 701, Ruiru, Kenya', 200, 70, { align: 'right' })
            .text('Phone: +254 794 501 005', 200, 80, { align: 'right' })
            .text('Email: support@leasecaptain.com', 200, 90, { align: 'right' })
            .text('Website: www.leasecaptain.com', 200, 100, { align: 'right' });

        // --- Invoice Title ---
        doc.moveDown(2);
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#003366')
            .text(`INVOICE #${invoice.invoiceNumber}`, { align: 'center' });
        doc.moveDown(1);

        // Status Badge
        const statusColor = invoice.status === 'paid' ? '#28a745' : invoice.status === 'overdue' ? '#dc3545' : '#ffc107';
        doc.fontSize(14).font('Helvetica-Bold').fillColor(statusColor)
            .text(invoice.status.toUpperCase(), 450, 130, { align: 'right' });

        // --- Invoice Details Section ---
        doc.moveDown(1.5);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366').text('Billed To:', 50, doc.y);
        doc.font('Helvetica').fillColor('#000000')
            .text(`${invoice.user.username}`, 50, doc.y + 5)
            .text(`${invoice.user.email}`, 50, doc.y + 5)
            .text(`${invoice.user.phone || 'N/A'}`, 50, doc.y + 5);

        const detailsY = doc.y + 10;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#003366')
            .text('Invoice Details:', 350, detailsY - 40);

        doc.font('Helvetica').fillColor('#000000');

        const labelX = 350;  // Column position for labels
        const valueX = 480;  // Column position for values

        doc.text('Transaction ID:', labelX, detailsY + 30, { continued: false })
            .text(invoice.transactionId || 'N/A', valueX, detailsY + 30)

            .text('Billing Period:', labelX, detailsY + 45, { continued: false })
            .text(invoice.billingPeriod, valueX, detailsY + 45);


        // --- Table Section ---
        doc.moveDown(2);
        const tableTop = doc.y;
        const col1 = 50;  // Description
        const col2 = 200; // Billing Period
        const col3 = 300; // Amount
        const col4 = 400; // Time
        const rowHeight = 25;

        // Table Header
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff');
        doc.rect(50, tableTop, 500, 30).fill('#003366').stroke('#003366');
        doc.fillColor('#ffffff');
        doc.text('Description', col1 + 10, tableTop + 8);
        doc.text('Billing Period', col2 + 10, tableTop + 8);
        doc.text('Amount (Ksh)', col3 + 10, tableTop + 8, { align: 'right' });

        // Table Row
        doc.fontSize(11).font('Helvetica').fillColor('#000000');
        doc.rect(50, tableTop + 30, 500, rowHeight).fill('#f9f9f9').stroke('#d3d3d3');
        doc.fillColor('#000000');
        doc.text('Subscription Payment', col1 + 10, tableTop + 35);
        doc.text(invoice.billingPeriod.charAt(0).toUpperCase() + invoice.billingPeriod.slice(1), col2 + 10, tableTop + 35);
        doc.text(`${invoice.amount.toFixed(2)}`, col3 + 10, tableTop + 35, { align: 'right' });


        // Total
        const totalY = tableTop + 90;
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#003366');
        doc.text(`Total: Ksh ${(invoice.amount).toFixed(2)}`, col3 - 50, totalY, { align: 'right' });

        // --- Footer Section ---
        const footerY = doc.page.height - 120;
        doc.lineWidth(1).strokeColor('#003366')
            .moveTo(50, footerY).lineTo(550, footerY).stroke();
        doc.fontSize(10).font('Helvetica').fillColor('#666666')
            .text('Thank you for trusting us with your business!', 50, footerY + 10, { align: 'center' })
            .text(`Payment Terms: Due within ${invoice.billingPeriod === 'yearly' ? '1 year' : '30 days'} | Contact us at support@leasecaptain.com`, 50, footerY + 25, { align: 'center' })
            .text('Lease Captain © 2025 | All Rights Reserved', 50, footerY + 40, { align: 'center' });

        // --- Watermark 
        doc.opacity(0.1);  // Set transparency for the watermark
        doc.image(path.join(__dirname, '../public/assets/images/2.png'), doc.page.width / 2 - 60, doc.page.height / 2 - 60, {
            width: 120,
            align: 'center'
        });
        doc.opacity(1); // Reset opacity back to normal for the rest of the document


        // Finalize the PDF
        doc.end();

    } catch (err) {
        console.error('Error generating invoice PDF:', err);
        req.flash('error', 'Failed to generate invoice PDF');
        res.redirect('/reports-invoices');
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

// POST route to create a new user
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
        res.redirect('/dashboard');
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

//POST Schedule Maintenance
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

//GET connect account
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

//POST connect account
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


// Edit account route
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

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            req.flash('error', 'Please provide a valid email address.');
            return res.redirect('/login');
        }

        const user = await User.findOne({ email });
        if (!user) {
            req.flash('error', 'No user found with that email address.');
            return res.redirect('/login');
        }

        // Generate a 6-digit reset code
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString(); // 100000-999999
        user.resetPasswordCode = resetCode;
        user.resetPasswordExpires = Date.now() + 3600000; // 1-hour expiration
        await user.save();

        // HTML email template with 6-digit code
        const mailOptions = {
            to: user.email,
            from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
            subject: 'Lease Captain Password Reset Code',
            html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Password Reset Code</title>
                    <style>
                        body { font-family: Arial, sans-serif; background-color: #f4f4f4; color: #333; margin: 0; padding: 0; }
                        .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
                        .header { background-color: #003366; color: #ffffff; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; }
                        .content { padding: 20px; line-height: 1.6; }
                        .code { display: inline-block; padding: 10px 20px; margin: 20px 0; background-color: #003366; color: #ffffff; font-size: 24px; font-weight: bold; border-radius: 5px; letter-spacing: 2px; }
                        .footer { margin-top: 20px; font-size: 0.8em; color: #777; text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">Lease Captain Password Reset</div>
                        <div class="content">
                            <p>Hello ${user.username || 'User'},</p>
                            <p>You are receiving this email because a password reset request was made for your account on Lease Captain.</p>
                            <p>Your reset code is:</p>
                            <div class="code">${resetCode}</div>
                            <p>Please enter this code on the reset password page. It will expire in 1 hour.</p>
                            <p>If you didn’t request a password reset, please ignore this email, and your password will remain unchanged.</p>
                        </div>
                        <div class="footer">© ${new Date().getFullYear()} Lease Captain. All rights reserved.</div>
                    </div>
                </body>
                </html>
            `,
        };

        // Send email
        await transporter.sendMail(mailOptions);

        req.flash('success', 'A password reset code has been sent to your email or spam.');
        res.redirect('/reset-password'); // Redirect to a page to enter the code
    } catch (error) {
        console.error('Error in forgot-password route:', error.message, error.stack);
        req.flash('error', 'Failed to send password reset code. Please try again later.');
        res.redirect('/login');
    }
});

// GET /reset-password
router.get('/reset-password', (req, res) => {
    res.render('reset-password');
});

// POST /reset-password
router.post('/reset-password', async (req, res) => {
    try {
        const { email, resetCode, password } = req.body;

        // Validate inputs
        if (!email || !resetCode || !password) {
            const missingFields = [];
            if (!email) missingFields.push('email');
            if (!resetCode) missingFields.push('reset code');
            if (!password) missingFields.push('password');
            req.flash('error', `Please provide all required fields: ${missingFields.join(', ')}.`);
            return res.redirect('/reset-password');
        }

        // Additional validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            req.flash('error', 'Please provide a valid email address.');
            return res.redirect('/reset-password');
        }
        if (!/^\d{6}$/.test(resetCode)) {
            req.flash('error', 'Reset code must be a 6-digit number.');
            return res.redirect('/reset-password');
        }
        if (password.length < 8) {
            req.flash('error', 'Password must be at least 8 characters long.');
            return res.redirect('/reset-password');
        }

        // Find user with valid reset code
        const user = await User.findOne({
            email,
            resetPasswordCode: resetCode,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            const expiredUser = await User.findOne({ email, resetPasswordCode: resetCode });
            if (expiredUser && expiredUser.resetPasswordExpires <= Date.now()) {
                req.flash('error', 'Your reset code has expired. Please request a new one.');
            } else {
                req.flash('error', 'Invalid reset code.');
            }
            return res.redirect('/reset-password');
        }

        // Check if new password differs from old (optional, requires storing old password hash)
        const isSamePassword = await bcrypt.compare(password, user.password);
        if (isSamePassword) {
            req.flash('error', 'New password must differ from the old password.');
            return res.redirect('/reset-password');
        }

        // Update password and clear reset fields
        user.password = await bcrypt.hash(password, 10);
        user.resetPasswordCode = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        req.flash('success', 'Password reset successfully. Please log in.');
        return res.redirect('/login');
    } catch (error) {
        console.error('Error in reset-password POST:', error.message, error.stack);
        req.flash('error', 'An unexpected error occurred while resetting your password. Please try again.');
        return res.redirect('/reset-password');
    }
});


// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});


// Multer instance with file size limit and file type filter
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) cb(null, true);
        else cb(new Error('Only images (jpeg, jpg, png) are allowed!'));
    }
});

// GET: Property Listing
router.get('/tenancy-manager/propertyListing', ensureAuthenticated, async (req, res) => {
    try {
        const properties = await PropertyList.find({ owner: req.user._id }).lean();
        res.render('tenancyManager/list', {
            currentUser: req.user,
            isNewUser: req.user.isNewUser || false,
            properties: properties || [],
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// POST: Add Property
router.post('/tenancy-manager/propertyListing/add', ensureAuthenticated, upload.array('images', 5), async (req, res) => {
    try {
        // Check if the user's plan is "Basic"
        if (req.user.plan === 'Basic') {
            req.flash('error', 'Property listing is not available on the Basic plan. Please upgrade your plan.');
            return res.redirect('/tenancy-manager/propertyListing');
        }

        // Proceed with adding the property for non-Basic users
        const { name, location, status, price, description, bedrooms, bathrooms, facilities, propertyType, category } = req.body;
        const imagePaths = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

        const newProperty = new PropertyList({
            name,
            location,
            status,
            price,
            description,
            bedrooms: parseInt(bedrooms),
            bathrooms: parseInt(bathrooms),
            facilities: Array.isArray(facilities) ? facilities : facilities ? [facilities] : [],
            propertyType,
            category,
            images: imagePaths,
            owner: req.user._id
        });

        await newProperty.save();
        req.flash('success', 'Property added successfully');
        res.redirect('/tenancy-manager/propertyListing');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add property');
        res.redirect('/tenancy-manager/propertyListing');
    }
});

// POST: Edit Property
router.post('/tenancy-manager/propertyListing/edit/:id', ensureAuthenticated, upload.array('images', 5), async (req, res) => {
    try {
        const propertyId = req.params.id;
        const property = await PropertyList.findById(propertyId);

        if (!property) {
            req.flash('error', 'Property not found');
            return res.redirect('/tenancy-manager/propertyListing');
        }

        // Check if user is the owner
        if (property.owner.toString() !== req.user._id.toString()) {
            req.flash('error', 'Unauthorized to edit this property');
            return res.redirect('/tenancy-manager/propertyListing');
        }

        // Prepare update object with type coercion and validation
        const updateData = {
            name: req.body.name?.trim(),
            location: req.body.location?.trim(),
            status: req.body.status,
            price: parseFloat(req.body.price) || 0,
            description: req.body.description?.trim(),
            bedrooms: parseInt(req.body.bedrooms) || 0,
            bathrooms: parseInt(req.body.bathrooms) || 0,
            facilities: Array.isArray(req.body.facilities) ? req.body.facilities :
                req.body.facilities ? [req.body.facilities] : [],
            propertyType: req.body.propertyType,
            category: req.body.category
        };

        // Handle image deletions
        let imagesToKeep = property.images || [];
        if (req.body.deleteImages) {
            const deleteImages = Array.isArray(req.body.deleteImages) ?
                req.body.deleteImages : [req.body.deleteImages];

            // Remove selected images and delete files from server
            deleteImages.forEach(imagePath => {
                imagesToKeep = imagesToKeep.filter(img => img !== imagePath);
                const filePath = path.join(__dirname, '../public', imagePath);
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (fileError) {
                        console.error(`Failed to delete file ${imagePath}:`, fileError);
                    }
                }
            });
        }

        // Handle new images if uploaded
        if (req.files && req.files.length > 0) {
            const newImages = req.files.map(file => `/uploads/${file.filename}`);
            updateData.images = [...imagesToKeep, ...newImages];

            // Validate total image count
            if (updateData.images.length > 10) {
                throw new Error('Maximum of 10 images allowed');
            }
        } else {
            updateData.images = imagesToKeep; // Preserve remaining images
        }

        // Additional validation
        if (!updateData.name || updateData.name.length < 2) {
            throw new Error('Name must be at least 2 characters');
        }
        if (!updateData.location || updateData.location.length < 2) {
            throw new Error('Location must be at least 2 characters');
        }
        if (!['available', 'rented', 'maintenance'].includes(updateData.status)) {
            throw new Error('Invalid status value');
        }
        if (updateData.price < 0) {
            throw new Error('Price cannot be negative');
        }
        if (updateData.bedrooms < 0) {
            throw new Error('Bedrooms cannot be negative');
        }
        if (updateData.bathrooms < 0) {
            throw new Error('Bathrooms cannot be negative');
        }

        // Update property
        const updatedProperty = await PropertyList.findByIdAndUpdate(
            propertyId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedProperty) {
            throw new Error('Update operation failed');
        }

        req.flash('success', 'Property updated successfully');
        res.redirect('/tenancy-manager/propertyListing');
    } catch (error) {
        console.error('Error updating property:', error);
        req.flash('error', 'Error updating property: ' + error.message);

        // Clean up uploaded files if update fails
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                const filePath = path.join(__dirname, '../public/uploads', file.filename);
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (fileError) {
                        console.error(`Failed to clean up file ${filePath}:`, fileError);
                    }
                }
            });
        }

        res.redirect('/tenancy-manager/propertyListing');
    }
});

// POST: Delete Property
router.post('/tenancy-manager/propertyListing/delete', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.body;
        const property = await PropertyList.findById(id);

        if (!property || property.owner.toString() !== req.user._id.toString()) {
            req.flash('error', 'Property not found or unauthorized');
            return res.redirect('/tenancy-manager/propertyListing');
        }

        // Optionally delete associated images from the server
        if (property.images && property.images.length > 0) {
            property.images.forEach(image => {
                const filePath = path.join(__dirname, '../public', image);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
        }

        await PropertyList.deleteOne({ _id: id });
        req.flash('success', 'Property deleted successfully');
        res.redirect('/tenancy-manager/propertyListing');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete property');
        res.redirect('/tenancy-manager/propertyListing');
    }
});

// GET: Expense Page
router.get('/expenses', async (req, res) => {
    try {
        const pageSize = 10;
        const currentPage = Math.max(1, Number(req.query.page) || 1); // Ensure currentPage is at least 1
        const searchQuery = req.query.search || '';

        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Fetch expenses
        const expenses = await Expense.find({
            owner: req.user._id,
            name: { $regex: searchQuery, $options: 'i' }
        })
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);

        // Calculate total expenses amount
        const totalExpensesAmount = await Expense.aggregate([
            { $match: { owner: req.user._id, name: { $regex: searchQuery, $options: 'i' } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        // Count total expenses for pagination
        const totalExpenses = await Expense.countDocuments({
            owner: req.user._id,
            name: { $regex: searchQuery, $options: 'i' }
        });

        const totalPages = Math.ceil(totalExpenses / pageSize);
        const totalAmount = totalExpensesAmount.length > 0 ? totalExpensesAmount[0].total : 0;

        // Ensure currentPage doesn’t exceed totalPages
        if (currentPage > totalPages && totalPages > 0) {
            return res.redirect(`/expenses?page=${totalPages}&search=${encodeURIComponent(searchQuery)}`);
        }

        res.render('tenancyManager/expense', {
            expenses,
            currentPage,
            totalPages,
            pageSize,
            search: searchQuery,
            currentUser: req.user,
            totalExpensesAmount: totalAmount,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (error) {
        console.error('Error fetching expenses:', error);
        req.flash('error', 'Error fetching expenses.');
        res.redirect('/');
    }
});

// Your POST route with multer middleware
router.post('/expenses', upload.single('receipt'), async (req, res) => {
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
            status: req.body.status || 'Pending',
            paymentMethod: req.body.paymentMethod,
            receipt: req.file ? req.file.path : undefined, // Store file path if uploaded
            notes: req.body.notes,
            tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : []
        });
        await newExpense.save();
        req.flash('success', 'Expense created successfully.');
        res.redirect('/expenses');
    } catch (error) {
        console.error('Error creating expense:', error);
        req.flash('error', 'Error creating expense: ' + error.message);
        res.redirect('/expenses');
    }
});

// POST route to delete an expense
router.post('/expenses/delete/:id', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        const expenseId = req.params.id;
        const expense = await Expense.findById(expenseId);

        if (!expense) {
            req.flash('error', 'Expense not found.');
            return res.redirect('/expenses');
        }

        // Optional: Check if the user owns the expense
        if (expense.owner.toString() !== req.user._id.toString()) {
            req.flash('error', 'You do not have permission to delete this expense.');
            return res.redirect('/expenses');
        }

        await Expense.findByIdAndDelete(expenseId);
        req.flash('success', 'Expense deleted successfully.');
        res.redirect('/expenses');
    } catch (error) {
        console.error('Error deleting expense:', error);
        req.flash('error', 'Error deleting expense: ' + error.message);
        res.redirect('/expenses');
    }
});

// Leases Page
router.get('/tenancy-manager/leases', ensureAuthenticated, async (req, res) => {
    const leases = await Lease.find();
    res.render('tenancyManager/leases', { leases,  currentUser: req.user });
  });
  
  // Lease Templates Page
router.get('/tenancy-manager/lease-templates', ensureAuthenticated, async (req, res) => {
    const templates = await LeaseTemplate.find();
    res.render('tenancyManager/lease-templates', { templates, currentUser: req.user });
  });
  
  // Lease Reports Page
router.get('/tenancy-manager/lease-reports', ensureAuthenticated, async (req, res) => {
    const reports = await LeaseReport.find().populate('leaseId');
    const activeLeases = await Lease.countDocuments({ status: 'Active' });
    const expiringSoon = await Lease.countDocuments({ endDate: { $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    const expiredLeases = await Lease.countDocuments({ status: 'Expired' });
    const totalRevenue = reports.reduce((sum, report) => sum + report.revenue, 0);
  
    res.render('tenancyManager/lease-reports', { reports, currentUser: req.user, activeLeases, expiringSoon, expiredLeases, totalRevenue });
  });

module.exports = router;
