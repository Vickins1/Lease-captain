const express = require('express');
const router = express.Router();
const axios = require('axios');
const PaymentAccount = require('../models/account');
const Tenant = require('../models/tenant');
const Payment = require('../models/payment');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid'); // Import uuid

// Rent Payment Endpoint
router.post('/payment/rent', async (req, res) => {
    const { amount, phoneNumber } = req.body;
    const tenantId = req.session.tenantId;

    if (!tenantId) {
        req.flash('error', 'Unauthorized: Tenant not found in session.');
        return res.redirect('/payments');
    }

    if (!phoneNumber) {
        req.flash('error', 'Phone number is required.');
        return res.redirect('/payments');
    }

    try {
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            req.flash('error', 'Tenant not found.');
            return res.redirect('/payments');
        }

        const creatorId = tenant.userId;
        const userPaymentAccount = await PaymentAccount.findOne({ userId: creatorId });
        if (!userPaymentAccount) {
            req.flash('error', 'Payment account for creator not found.');
            return res.redirect('/payments');
        }

        const payload = {
            api_key: userPaymentAccount.apiKey,
            email: userPaymentAccount.accountEmail,
            account_id: userPaymentAccount.accountId,
            amount: parseFloat(amount), 
            msisdn: phoneNumber,
            reference: Date.now().toString(),
        };

        // Make the payment request
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/intiatestk',
            payload,
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        // Process rent due
        const rentDue = parseFloat(tenant.rentDue) || 0; 
        const rentPaid = parseFloat(amount) || 0;

        if (isNaN(rentDue) || isNaN(rentPaid)) {
            throw new Error("Rent due or amount is not a valid number.");
        }

        const newDue = rentDue - rentPaid;

        // Generate a unique transaction ID
        const transactionId = uuidv4(); 

        // Create the payment
        const payment = await Payment.create({
            tenantName: tenant.name,
            property: tenant.property,
            unit: tenant.unit,
            doorNumber: tenant.doorNumber,
            amount: rentPaid,
            paymentType: 'rent',
            totalPaid: rentPaid,
            due: newDue,
            datePaid: new Date(),
            method: 'mobile',
            status: 'pending',
            transactionId: transactionId, 
        });

        // Log the created payment for debugging
        console.log('Payment created:', payment);

        // Automatically update the payment status to 'completed'
        payment.status = 'completed'; 
        await payment.save(); 

        // Log the updated payment for debugging
        console.log('Payment status updated to completed:', payment);

        req.flash('success', 'Rent payment initiated successfully.');
        return res.redirect('/payments');
    } catch (error) {
        handlePaymentError(error, res);
    }
});


// Utility Payment Endpoint
router.post('/payment/utility', async (req, res) => {
    const { amount, phoneNumber } = req.body;
    const tenantId = req.session.tenantId;

    if (!tenantId) {
        req.flash('error', 'Unauthorized: Tenant not found in session.');
        return res.redirect('/payments');
    }

    if (!phoneNumber) {
        req.flash('error', 'Phone number is required.');
        return res.redirect('/payments');
    }

    try {
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            req.flash('error', 'Tenant not found.');
            return res.redirect('/payments');
        }

        const creatorId = tenant.userId;
        const userPaymentAccount = await PaymentAccount.findOne({ userId: creatorId });
        if (!userPaymentAccount) {
            req.flash('error', 'Payment account for creator not found.');
            return res.redirect('/payments');
        }

        const payload = {
            api_key: userPaymentAccount.apiKey,
            email: userPaymentAccount.accountEmail,
            account_id: userPaymentAccount.accountId,
            amount: parseFloat(amount),
            msisdn: phoneNumber,
            reference: Date.now().toString(),
        };

        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/intiatestk',
            payload,
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        const utilityDue = parseFloat(tenant.utilityDue) || 0;
        const totalPaid = parseFloat(amount) || 0;
        if (isNaN(utilityDue) || isNaN(totalPaid)) {
            throw new Error("Utility due or amount is not a valid number.");
        }

        const newUtilityDue = utilityDue - totalPaid;

        await Payment.create({
            tenantName: tenant.name,
            property: tenant.property,
            unit: tenant.unit,
            doorNumber: tenant.doorNumber,
            amount: totalPaid,
            paymentType: 'utility',
            totalPaid: totalPaid,
            due: newUtilityDue,
            datePaid: new Date(),
            method: 'mobile',
            status: 'pending'
        });

        req.flash('success', 'Utility payment initiated successfully.');
        return res.redirect('/payments');
    } catch (error) {
        handlePaymentError(error, res);
    }
});

// Error Handling Function
function handlePaymentError(error, res) {
    if (error.response) {
        console.error('Error response data:', error.response.data);
        req.flash('error', error.response.data.message || 'Payment failed.');
    } else if (error.request) {
        console.error('No response received:', error.request);
        req.flash('error', 'No response from payment server. Please try again.'); 
    } else {
        console.error('Payment initiation failed:', error.message);
        req.flash('error', 'Payment initiation failed. Please try again.');
    }
    return res.redirect('/payments');
}

// Webhook Route for Payment Status Updates
router.post('/webhook/payment', async (req, res) => {
    try {
        const { tenantName, property, amount, method, status, paymentType, totalPaid, due, datePaid } = req.body;

        console.log('Webhook received:', req.body);

        await Payment.create({
            tenantName,
            property,
            amount,
            paymentType,
            method,
            status,
            totalPaid,
            due,
            datePaid: datePaid || new Date(),
        });

        res.status(200).json({ message: 'Payment recorded successfully.' });
    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(500).json({ message: 'Failed to record payment.' });
    }
});

module.exports = router;
