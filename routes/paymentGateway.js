const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const axios = require('axios');
const Property = require('../models/property');
const Tenant = require('../models/tenant');
const Payment = require('../models/payment');
require('dotenv').config();
const nodemailer = require('nodemailer');
const EventEmitter = require('events');
const paymentEvents = new EventEmitter();
const moment = require('moment');
const path = require('path');
PDFDocument = require('pdfkit');

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
});


// Function to update tenant dues and create payment record
const updateTenantDues = async (tenantId, paymentType, amount, transactionId) => {
    try {
        // Fetch tenant and related data
        const tenant = await Tenant.findById(tenantId).populate('property');
        if (!tenant) throw new Error('Tenant not found');

        const property = tenant.property;
        const unit = await PropertyUnit.findById(tenant.unit);
        if (!property || !unit) throw new Error('Property or unit not found');

        // Calculate months since lease start
        const leaseStart = moment(tenant.leaseStartDate);
        const leaseEnd = moment(tenant.leaseEndDate);
        const currentDate = moment();
        const effectiveEnd = leaseEnd.isBefore(currentDate) ? leaseEnd : currentDate;
        const monthsSinceStart = effectiveEnd.diff(leaseStart, 'months');

        let remainingDue;

        if (paymentType === 'rent') {
            // Update total rent paid
            tenant.rentPaid = (tenant.rentPaid || 0) + amount;

            // Calculate expected rent
            const expectedRent = monthsSinceStart * unit.unitPrice;

            // Update rent due
            remainingDue = Math.max(expectedRent - tenant.rentPaid, 0);
            tenant.rentDue = remainingDue;
        } else if (paymentType === 'utility') {
            // Update total utility paid
            tenant.utilityPaid = (tenant.utilityPaid || 0) + amount;

            // Calculate total monthly utility charges
            const unitUtilities = Array.isArray(unit.utilities) ? unit.utilities : [];
            const totalUtilityChargesPerMonth = unitUtilities.reduce(
                (acc, utility) => acc + (utility.amount || 0),
                0
            );

            // Calculate expected utility
            const expectedUtility = monthsSinceStart * totalUtilityChargesPerMonth;

            // Update utility due
            remainingDue = Math.max(expectedUtility - tenant.utilityPaid, 0);
            tenant.utilityDue = remainingDue;
        } else {
            throw new Error('Invalid payment type');
        }

        // Create payment record
        const payment = new Payment({
            owner: property.owner,
            tenant: tenant._id,
            tenantName: tenant.name,
            property: tenant.property,
            unit: tenant.unit || null,
            doorNumber: tenant.doorNumber,
            amount,
            totalPaid: amount,
            due: remainingDue,
            method: 'mobilePayment',
            paymentType,
            transactionId,
            status: 'completed',
            rentPaid: paymentType === 'rent' ? amount : 0,
            utilityPaid: paymentType === 'utility' ? amount : 0,
            datePaid: new Date()
        });

        // Save payment and update tenant
        await payment.save();
        tenant.payments.push(payment._id);
        await tenant.save();

        // Update property (if needed)
        await property.updateRentUtilitiesAndTenants();
        return payment;
    } catch (error) {
        console.error('Error updating tenant dues:', error);
        throw error;
    }
};

// Function to send payment initiation request
async function sendPaymentRequest(payload, req, res, account) {
    try {
        const transactionId = payload.transaction_id || `LC${Math.floor(100000 + Math.random() * 900000)}`;
        payload.transaction_id = transactionId;

        console.log('Sending payment initiation request with payload:', payload);

        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/intiatestk',
            payload,
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        console.log('Payment initiation response:', response.data);

        if (response.status === 200 && response.data.success === '200' && response.data.tranasaction_request_id) {
            console.log('Payment request successful:', response.data);
            return {
                success: '200',
                transaction_request_id: response.data.tranasaction_request_id,
                transactionId: transactionId,
                responseData: response.data
            };
        } else {
            console.error('Invalid response from payment initiation:', response.data);
            return { success: 'error', errorDetails: response.data.message || 'Invalid response format' };
        }
    } catch (err) {
        const errorMessage = err.response?.data?.message || err.message || 'Unknown error';
        console.error('Payment request failed:', errorMessage);
        return { success: 'error', errorDetails: errorMessage };
    }
}

// In-memory store for payment statuses
const paymentStatuses = {};

// Existing pollPaymentStatus function 
async function pollPaymentStatus(transactionRequestId, transactionId, api_key, email, expectedAmount, tenant, paymentType, msisdn, account) {
    const pollingInterval = 3000;
    const pollingTimeout = 60000;
    const maxAttempts = Math.floor(pollingTimeout / pollingInterval);
    let attempts = 0;
    const maxRetries = 3;

    console.log(`Starting polling for transactionId: ${transactionId}, requestId: ${transactionRequestId}`);

    const poll = async () => {
        let retryCount = 0;

        while (retryCount <= maxRetries) {
            try {
                const verificationPayload = {
                    api_key: account.apiKey,
                    email: account.accountEmail,
                    transaction_id: transactionId,
                    tranasaction_request_id: transactionRequestId,
                };

                console.log(`Polling attempt ${attempts + 1}/${maxAttempts}, retry ${retryCount}/${maxRetries} with payload:`, verificationPayload);

                const response = await axios.post(
                    'https://api.umeskiasoftwares.com/api/v1/transactionstatus',
                    verificationPayload,
                    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
                );


                const { ResultCode, TransactionStatus, TransactionAmount } = response.data;

                if (TransactionStatus === 'Completed' && ResultCode === '200') {
                    const receivedAmount = parseFloat(TransactionAmount);
                    const expected = parseFloat(expectedAmount);

                    if (receivedAmount >= expected) {
                        try {
                            const payment = await updateTenantDues(tenant, paymentType, receivedAmount, transactionId);
                            const property = await Property.findById(tenant.property).populate('owner');
                            const ownerEmail = property.owner.email;
                            const ownerPhone = property.owner.phone;


                            if (ownerEmail) await sendPaymentNotificationEmail(ownerEmail, tenant.name, receivedAmount, paymentType);
                            if (ownerPhone) await sendPaymentNotificationSMS(ownerPhone, tenant.name, receivedAmount, paymentType);

                            const paymentData = {
                                tenantName: tenant.name,
                                transactionId,
                                paymentType,
                                amount: receivedAmount,
                                datePaid: payment.datePaid,
                                propertyName: property.name,
                                doorNumber: tenant.doorNumber,
                                method: payment.method,
                                due: payment.due
                            };
                            if (tenant.email) await sendTenantConfirmationEmail(tenant.email, paymentData);
                            if (tenant.phone) await sendTenantConfirmationSMS(tenant.phone, paymentData);

                            const eventData = {
                                status: 'completed',
                                message: `${paymentType === 'rent' ? 'Rent' : 'Utility'} payment of Ksh.${receivedAmount.toFixed(2)} completed successfully!`,
                                redirect: '/tenantPortal/dashboard'
                            };
                            paymentEvents.emit(transactionId, eventData);
                            paymentStatuses[transactionId] = eventData; // Store final status
                            return true;
                        } catch (updateError) {
                            const eventData = {
                                status: 'failed',
                                message: `Payment processing failed: ${updateError.message}`,
                                redirect: '/payments'
                            };

                            paymentEvents.emit(transactionId, eventData);
                            paymentStatuses[transactionId] = eventData; // Store final status
                            return true;
                        }
                    } else {
                        const eventData = {
                            status: 'failed',
                            message: `Insufficient payment amount. Expected Ksh.${expected.toFixed(2)}, received Ksh.${receivedAmount.toFixed(2)}.`,
                            redirect: '/payments'
                        };
                        paymentEvents.emit(transactionId, eventData);
                        paymentStatuses[transactionId] = eventData; // Store final status
                        return true;
                    }
                } else if (TransactionStatus === 'Pending') {
                    const eventData = {
                        status: 'pending',
                        message: 'Payment is still processing. Please wait...'
                    };
                    console.log(`Emitting event for transactionId ${transactionId}:`, eventData);
                    paymentEvents.emit(transactionId, eventData);
                    paymentStatuses[transactionId] = eventData; // Store interim status
                    return false;
                } else {
                    const eventData = {
                        status: 'failed',
                        message: `Payment failed with status: ${TransactionStatus}. Please try again.`,
                        redirect: '/payments'
                    };
                    paymentEvents.emit(transactionId, eventData);
                    paymentStatuses[transactionId] = eventData; // Store final status
                    return true;
                }
            } catch (error) {
                console.error(`Polling error for transactionId ${transactionId}, retry ${retryCount}/${maxRetries}:`, error.message);
                if (error.code === 'ECONNRESET' && retryCount < maxRetries) {
                    retryCount++;
                    const eventData = {
                        status: 'pending',
                        message: `Retrying payment verification (${retryCount}/${maxRetries})...`
                    };
                    console.log(`Emitting retry event for transactionId ${transactionId}:`, eventData);
                    paymentEvents.emit(transactionId, eventData);
                    paymentStatuses[transactionId] = eventData; // Store interim status
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    continue;
                }

                const errorMessage = error.message.includes('timeout')
                    ? 'Payment verification timed out. Please check your status later.'
                    : `Payment verification failed: ${error.message}`;
                const eventData = {
                    status: 'failed',
                    message: errorMessage,
                    redirect: '/payments'
                };
                console.log(`Emitting error event for transactionId ${transactionId}:`, eventData);
                paymentEvents.emit(transactionId, eventData);
                paymentStatuses[transactionId] = eventData; // Store final status
                return true;
            }
        }
    };

    const initialEvent = {
        status: 'pending',
        message: 'Starting payment verification...'
    };
    console.log(`Emitting initial event for transactionId ${transactionId}:`, initialEvent);
    paymentEvents.emit(transactionId, initialEvent);
    paymentStatuses[transactionId] = initialEvent; // Store initial status

    while (attempts < maxAttempts) {
        console.log(`Polling loop iteration ${attempts + 1}/${maxAttempts} for transactionId ${transactionId}`);
        const shouldStop = await poll();
        if (shouldStop) {
            console.log(`Polling stopped for transactionId ${transactionId} after ${attempts + 1} attempts`);
            break;
        }

        attempts++;
        const eventData = {
            status: 'pending',
            message: `Checking payment status... (${attempts}/${maxAttempts})`
        };
        console.log(`Emitting event for transactionId ${transactionId}:`, eventData);
        paymentEvents.emit(transactionId, eventData);
        paymentStatuses[transactionId] = eventData; // Store interim status
        await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }

    if (attempts >= maxAttempts) {
        const eventData = {
            status: 'timeout',
            message: 'Payment verification timed out after 60 seconds. Please check your payment status later.',
            redirect: '/payments'
        };

        paymentEvents.emit(transactionId, eventData);
        paymentStatuses[transactionId] = eventData; // Store final status
    }

}

// New AJAX endpoint to fetch payment status
router.get('/payment-status', (req, res) => {
    const transactionId = req.query.transactionId;

    if (!transactionId) {
        return res.status(400).json({ status: 'error', message: 'Transaction ID is required' });
    }

    const status = paymentStatuses[transactionId];
    if (status) {
        res.json(status);
    } else {
        res.status(404).json({ status: 'pending', message: 'Payment status not found. Still processing...' });
    }
});

// Endpoint to handle payment confirmation
router.get('/payments', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;

        // Check if tenantId is defined
        if (!tenantId) {
            console.log('Tenant ID is undefined');
            req.flash('error', 'Please log in first.');
            return res.redirect('/tenantPortal/login');
        }

        // Fetch tenant details
        const tenant = await Tenant.findById(tenantId).exec();

        if (!tenant) {
            console.log(`Tenant not found for ID: ${tenantId}`);
            req.flash('error', 'Tenant not found.');
            return res.redirect('/tenantPortal/login');
        }

        // Pagination parameters
        const perPage = 10; // Payments per page
        const page = parseInt(req.query.page) || 1;
        const skip = (perPage * page) - perPage;

        // Fetch total payments for pagination
        const totalPayments = await Payment.countDocuments({ tenant: tenantId });

        // Fetch paginated payments, sorted by datePaid descending
        const payments = await Payment.find({ tenant: tenantId })
            .sort({ datePaid: -1 }) // Newest first
            .skip(skip)
            .limit(perPage)
            .lean(); // Use lean() for performance

        // Calculate total pages
        const totalPages = Math.ceil(totalPayments / perPage);

        // Provide feedback if no payments exist
        if (totalPayments === 0) {
            req.flash('info', 'No payments found for your account.');
        }

        // Render the payments page with tenant and paginated payment data
        res.render('tenantPortal/payments', {
            tenant,
            payments,
            title: 'Your Payments',
            success: req.flash('success'),
            error: req.flash('error'),
            info: req.flash('info'),
            currentPage: page,
            perPage,
            totalPages,
            totalPayments
        });
    } catch (error) {
        console.error('Error fetching payment data:', error.message);
        req.flash('error', 'An error occurred while fetching your payment data. Please try again later.');
        res.redirect('/tenantPortal/dashboard');
    }
});

// Tenant confirmation email
const sendTenantConfirmationEmail = async (tenantEmail, paymentData) => {
    const mailOptions = {
        from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
        to: tenantEmail,
        subject: `Payment Receipt: ${paymentData.paymentType} Payment Confirmation`,
        html: `
        <div style="font-family: Arial, sans-serif; background-color: #ffffff; padding: 20px; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 0; overflow: hidden;">
                <div style="background-color: #003366; color: #ffffff; padding: 20px; text-align: center;">
                    <h1 style="margin: 0; font-size: 18px;"><strong>Payment Receipt</strong></h1>
                </div>
                <div style="padding: 20px;">
                    <p style="font-size: 14px; line-height: 1.6;">Dear <strong>${paymentData.tenantName}</strong>,</p>
                    <p style="font-size: 14px; line-height: 1.6;">Thank you for your payment! Below is your receipt.</p>
                    <h3 style="font-size: 16px; margin-top: 20px;">Receipt Details</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Transaction ID:</strong></td>
                            <td style="padding: 8px;">${paymentData.transactionId}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Payment Type:</strong></td>
                            <td style="padding: 8px;">${paymentData.paymentType}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Amount Paid:</strong></td>
                            <td style="padding: 8px;">Ksh.${paymentData.amount.toFixed(2)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Date Paid:</strong></td>
                            <td style="padding: 8px;">${new Date(paymentData.datePaid).toLocaleString()}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Property:</strong></td>
                            <td style="padding: 8px;">${paymentData.propertyName || 'N/A'}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Door Number:</strong></td>
                            <td style="padding: 8px;">${paymentData.doorNumber}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Payment Method:</strong></td>
                            <td style="padding: 8px;">${paymentData.method}</td>
                        </tr>
                    </table>
                    <p style="font-size: 14px; line-height: 1.6; margin-top: 20px;">Contact us with any questions.</p>
                </div>
                <div style="background-color: #003366; color: #ffffff; padding: 10px; text-align: center; font-size: 12px;">
                    <p style="margin: 0;">Lease Captain | Property Management Simplified</p>
                    <p style="margin: 0;">© ${new Date().getFullYear()} Lease Captain. All Rights Reserved.</p>
                </div>
            </div>
        </div>
    `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Payment confirmation email sent successfully to tenant.');
    } catch (error) {
        console.error('Error sending payment confirmation email to tenant:', error.message);
    }
};

// Tenant confirmation SMS
const sendTenantConfirmationSMS = async (tenantPhone, paymentData) => {
    const message = `Dear ${paymentData.tenantName},\nYour ${paymentData.paymentType} payment of Ksh.${paymentData.amount.toFixed(2)} is confirmed.\nTransaction ID: ${paymentData.transactionId}\nDate: ${new Date(paymentData.datePaid).toLocaleDateString()}\nProperty: ${paymentData.propertyName || 'N/A'}\nDoor: ${paymentData.doorNumber ?? 'N/A'}\n\nGet more details on your tenant portal.\n\nThank you,\nLease Captain`;

    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',
            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message,
                phone: tenantPhone,
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log('Payment confirmation SMS sent successfully to tenant:', response.data);
    } catch (error) {
        console.error('Error sending SMS to tenant via UMS API:', error.response?.data || error.message);
    }
};

// Owner notification email
const sendPaymentNotificationEmail = async (ownerEmail, tenantName, amount, paymentType) => {
    const mailOptions = {
        from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
        to: ownerEmail,
        subject: `Payment Notification: ${tenantName} (${paymentType})`,
        html: `
        <div style="font-family: Arial, sans-serif; background-color: #ffffff; padding: 20px; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 0; overflow: hidden;">
                <div style="background-color: #003366; color: #ffffff; padding: 20px; text-align: center;">
                    <h1 style="margin: 0; font-size: 15px;"><strong>Payment Notification</strong></h1>
                </div>
                <div style="padding: 20px;">
                    <p style="font-size: 13px; line-height: 1.6;">Dear <strong>Property Owner</strong>,</p>
                    <p style="font-size: 13px; line-height: 1.6;">We are pleased to inform you that <strong>${tenantName}</strong> has successfully made a payment.</p>
                    <p style="font-size: 15px; line-height: 1.6;"><strong>Payment Details:</strong></p>
                    <ul style="font-size: 15px; line-height: 1.6; list-style: none; padding: 0;">
                        <li style="margin-bottom: 8px;"><strong>Payment Type: </strong> ${paymentType}</li>
                        <li><strong>Amount:</strong> Ksh.${amount.toFixed(2)}</li>
                    </ul>
                    <p style="font-size: 13px; line-height: 1.6;">Thank you for using Lease Captain to manage your properties.</p>
                </div>
                <div style="background-color: #003366; color: #ffffff; padding: 10px; text-align: center; font-size: 14px;">
                    <p style="margin: 0;">Lease Captain | Property Management Simplified</p>
                    <p style="margin: 0;">© ${new Date().getFullYear()} Lease Captain. All Rights Reserved.</p>
                </div>
            </div>
        </div>
    `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Payment notification email sent successfully to owner.');
    } catch (error) {
        console.error('Error sending payment notification email to owner:', error.message);
    }
};

// Owner notification SMS
const sendPaymentNotificationSMS = async (ownerPhone, tenantName, amount, paymentType) => {
    const message = `Dear Property Owner,\n\n${tenantName} has made a ${paymentType} payment of Ksh.${amount.toFixed(2)}. Log in to Lease Captain for details.\n\nBest regards,\nLease Captain`;

    // Validate and format phone number
    let formattedPhone = ownerPhone?.trim() || '';
    if (!formattedPhone) {
        console.warn('Owner phone number is missing or empty. Skipping SMS notification.');
        return;
    }

    // Define expected Kenyan format: starts with 0, 10 digits total
    const phoneRegex = /^0\d{9}$/;

    // Check if already valid
    if (!phoneRegex.test(formattedPhone)) {
        const fixableRegex = /^[719]\d{8}$/;
        if (fixableRegex.test(formattedPhone)) {
            formattedPhone = `0${formattedPhone}`;
            console.log(`Auto-corrected phone number from ${ownerPhone} to ${formattedPhone}`);
        } else {
            console.warn(`Invalid phone number format: ${formattedPhone}. Expected format: 0798765432. Skipping SMS notification.`);
            return;
        }
    }

    // Double-check after correction
    if (!phoneRegex.test(formattedPhone)) {
        console.warn(`Phone number correction failed: ${formattedPhone}. Skipping SMS notification.`);
        return;
    }

    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',
            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message,
                phone: formattedPhone,
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        console.log('Payment notification SMS sent successfully to owner:', response.data);

        // Check API response for success
        if (response.data.success === '200') {
            return; // Success
        } else {
            console.error(`SMS API error: ${response.data.errorMessage || 'Unknown error in response'}`);
        }
    } catch (error) {
        const errorDetails = error.response?.data || error.message;
        console.error('Error sending SMS to owner via UMS API:', errorDetails);
    }
};

// Middleware to fetch tenant from session
const fetchTenantFromSession = async (req, res, next) => {
    if (!req.session.tenantId) {
        return res.status(401).json({ message: 'Tenant not authenticated. Please log in.' });
    }

    try {
        const tenant = await Tenant.findById(req.session.tenantId);
        if (!tenant) {
            req.session.destroy(); // Clear invalid session
            return res.status(401).json({ message: 'Tenant not found. Please log in again.' });
        }
        req.tenant = tenant; // Attach tenant to request object
        next();
    } catch (error) {
        console.error('Error fetching tenant from session:', error);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
};

// Payment routes with session-based authentication
router.post('/payment/rent', fetchTenantFromSession, async (req, res) => {
    const { msisdn, amount } = req.body;
    const tenant = req.tenant;

    try {
        // Fetch property and owner
        const property = await Property.findById(tenant.property).populate('owner');
        if (!property) return res.status(404).json({ message: 'Property not found.' });

        // Fetch account details for the owner
        const account = await Account.findOne({ userId: property.owner._id, status: 'active' });
        if (!account) return res.status(400).json({ message: 'No active payment account found for the property owner.' });

        const payload = {
            api_key: account.apiKey,
            email: account.accountEmail,
            account_id: account.accountId,
            amount: Math.floor(parseFloat(amount)).toString(),
            msisdn: msisdn.trim(),
            reference: `VT${Date.now()}`,
        };

        const paymentResponse = await sendPaymentRequest(payload, req, res, account);

        if (paymentResponse?.success === '200') {
            const transactionRequestId = paymentResponse.transaction_request_id;
            const transactionId = `LC${Math.floor(100000 + Math.random() * 900000)}`;

            res.json({ transactionId });
            pollPaymentStatus(transactionRequestId, transactionId, account.apiKey, account.accountEmail, amount, tenant, 'rent', msisdn, account);
        } else {
            res.status(400).json({ message: paymentResponse.errorDetails || 'Payment initiation failed.' });
        }
    } catch (error) {
        console.error('Error in /payment/rent:', error.message);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
});

// Utility payment route
router.post('/payment/utility', fetchTenantFromSession, async (req, res) => {
    const { msisdn, amount } = req.body;
    const tenant = req.tenant;

    try {
        // Fetch property and owner
        const property = await Property.findById(tenant.property).populate('owner');
        if (!property) return res.status(404).json({ message: 'Property not found.' });

        // Fetch account details for the owner
        const account = await Account.findOne({ userId: property.owner._id, status: 'active' });
        if (!account) return res.status(400).json({ message: 'No active payment account found for the property owner.' });

        const payload = {
            api_key: account.apiKey,
            email: account.accountEmail,
            account_id: account.accountId,
            amount: Math.floor(parseFloat(amount)).toString(),
            msisdn: msisdn.trim(),
            reference: `VT${Date.now()}`,
        };

        const paymentResponse = await sendPaymentRequest(payload, req, res, account);

        if (paymentResponse?.success === '200') {
            const transactionRequestId = paymentResponse.transaction_request_id;
            const transactionId = `LC${Math.floor(100000 + Math.random() * 900000)}`;

            res.json({ transactionId });
            pollPaymentStatus(transactionRequestId, transactionId, account.apiKey, account.accountEmail, amount, tenant, 'utility', msisdn, account);
        } else {
            res.status(400).json({ message: paymentResponse.errorDetails || 'Payment initiation failed.' });
        }
    } catch (error) {
        console.error('Error in /payment/utility:', error.message);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
});

// Download receipt route
router.get('/download-receipt/:Id', fetchTenantFromSession, async (req, res) => {
    try {
        const paymentId = req.params.Id;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            console.error(`Invalid payment ID: ${paymentId}`);
            req.flash('error', 'Invalid payment ID');
            return res.redirect('/payments');
        }

        const payment = await Payment.findById(paymentId)
            .populate('tenant', 'name email phone doorNumber')
            .populate('property', 'name')
            .populate('owner', 'name')
            .populate('unit', 'unitType')
            .lean();

        if (!payment) {
            console.error(`Payment not found for ID: ${paymentId}`);
            req.flash('error', 'Payment not found');
            return res.redirect('/payments');
        }

        const isTenant = payment.tenant?._id?.toString() === req.tenant._id.toString();
        const isOwner = payment.owner?._id?.toString() === req.tenant._id.toString();

        if (!isTenant && !isOwner) {
            console.error(`Unauthorized access attempt by tenant ${req.tenant._id} for payment ${paymentId}`);
            req.flash('error', 'Unauthorized access to receipt');
            return res.redirect('/payments');
        }

        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            info: { Title: `Receipt ${payment.transactionId || paymentId}`, Author: 'Lease Captain' }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `attachment; filename=receipt-${payment.transactionId || paymentId}-${Date.now()}.pdf`);
        doc.pipe(res);

        // Watermark with rotation
        try {
            doc.save()
                .opacity(0.05)
                .rotate(45)
                .image(path.join(__dirname, '../public/assets/images/2.png'), 200, 300, {
                    width: 250,
                    height: 250
                })
                .restore();
        } catch (watermarkErr) {
            console.error('Failed to load watermark:', watermarkErr.message);
        }

        // Header 
        try {
            doc.image(path.join(__dirname, '../public/assets/images/2.png'), 40, 20, { width: 80 });
        } catch (imgErr) {
            console.error('Failed to load logo:', imgErr.message);
            doc.fontSize(20).fillColor('#003366').text('LC', 40, 40);
        }

        doc.font('Helvetica-Bold').fillColor('#003366')
            .fontSize(28).text('Lease Captain', 130, 30)
            .fontSize(11).font('Helvetica-Oblique').fillColor('#666666')
            .font('Helvetica').fontSize(9).fillColor('#444444')
            .text('P.O. Box 701, Ruiru', 450, 40, { align: 'right' })
            .text('+254 794 501 005', 450, 55, { align: 'right' })
            .text('info@leasecaptain.com', 450, 70, { align: 'right' })
            .text('www.leasecaptain.com', 450, 85, { align: 'right' });

        // Receipt Title
        doc.moveDown(3)
            .fontSize(20).fillColor('#003366').font('Helvetica-Bold')
            .text(`RECEIPT No: ${payment.transactionId || paymentId}`, { align: 'center' })
            .moveDown(0.5) // Adds slight spacing for better visual balance
            .moveTo(150, doc.y).lineTo(450, doc.y)



        // Details Section (no borders)
        doc.moveDown(2);
        const leftY = doc.y;
        doc.fontSize(14).fillColor('#003366').font('Helvetica-Bold')
            .text('Received From:', 40, leftY)
            .fontSize(11).fillColor('#333333').font('Helvetica')
            .text(payment.tenant?.name || payment.tenantName || 'Unknown', 40, leftY + 20)
            .text(payment.tenant?.email || 'N/A', 40, leftY + 35)
            .text(payment.tenant?.phone || 'N/A', 40, leftY + 50);

        const rightY = leftY;
        doc.fontSize(14).fillColor('#003366').font('Helvetica-Bold')
            .text('Payment Details:', 310, rightY)
            .fontSize(11).fillColor('#333333').font('Helvetica')
            .text(`Property: ${payment.property?.name || 'N/A'}`, 310, rightY + 20)
            .text(`Unit: ${payment.unit?.unitType || 'N/A'} (${payment.tenant?.doorNumber || payment.doorNumber || 'N/A'})`, 310, rightY + 35)
            .text(`Date: ${payment.datePaid ? new Date(payment.datePaid).toLocaleDateString() : 'N/A'}`, 310, rightY + 50)
            .text(`Method: ${payment.method || 'N/A'}`, 310, rightY + 65);

        // Payment Table (minimal borders)
        const tableTop = doc.y + 20;
        doc.lineWidth(1).rect(40, tableTop, 520, 30).fill('#003366')
            .fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
            .text('Description', 50, tableTop + 8)
            .text('Type', 200, tableTop + 8)
            .text('Date', 350, tableTop + 8)
            .text('Amount (Ksh)', 450, tableTop + 8, { align: 'right' });

        let currentY = tableTop + 30;
        let rowCount = 0;

        const addTableRow = (desc, type, amount) => {
            const fillColor = rowCount % 2 === 0 ? '#f8f9fa' : '#ffffff';
            doc.rect(40, currentY, 520, 25).fill(fillColor)
                .fontSize(11).fillColor('#333333').font('Helvetica')
                .text(desc, 50, currentY + 5)
                .text(type, 200, currentY + 5).text(new Date(payment.datePaid).toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }), 350, currentY + 5)
                .text(Number(amount).toFixed(2), 450, currentY + 5, { align: 'right' });
            currentY += 25;
            rowCount++;
        };

        if (payment.rentPaid > 0) addTableRow('Rent Payment', 'Rent', payment.rentPaid);
        if (payment.utilityPaid > 0) addTableRow('Utility Payment', 'Utility', payment.utilityPaid);
        if (payment.paymentType === 'other' && payment.rentPaid === 0 && payment.utilityPaid === 0) {
            addTableRow('Other Payment', 'Other', payment.amount);
        }

        // Total (no border)
        doc.moveTo(400, currentY + 5).lineTo(550, currentY + 5).lineWidth(1).stroke('#28a745')
            .fontSize(14).fillColor('#003366').font('Helvetica-Bold')
            .text(`Total Paid: Ksh ${Number(payment.totalPaid).toFixed(2)}`, 400, currentY + 15, { align: 'right' });

        // Footer (white background)
        const footerY = doc.page.height - 100;
        doc.fontSize(10).fillColor('#666666').font('Helvetica-Oblique')
            .text('Thank you for your payment!', 0, footerY + 20, { align: 'center', width: 612 })
            .font('Helvetica')
            .text('This is an auto-generated receipt | Contact: support@leasecaptain.com | Lease Captain © 2025 | All Rights Reserved', 0, footerY + 40, { align: 'center', width: 612 })
            .moveTo(40, footerY).lineTo(572, footerY).lineWidth(0.5).stroke('#cccccc');

        // --- Watermark 
        doc.opacity(0.1);  // Set transparency for the watermark
        doc.image(path.join(__dirname, '../public/assets/images/2.png'), doc.page.width / 2 - 60, doc.page.height / 2 - 60, {
            width: 120,
            align: 'center'
        });
        doc.opacity(1); // Reset opacity back to normal for the rest of the document


        doc.on('end', () => {
            console.log(`Receipt generated successfully for payment ${paymentId} by tenant ${req.tenant._id}`);
        });

        doc.end();

    } catch (err) {
        console.error('Error generating receipt PDF:', {
            message: err.message,
            stack: err.stack,
            paymentId: req.params.Id,
            tenantId: req.tenant?._id
        });
        req.flash('error', 'Failed to generate receipt');
        res.redirect('/payments');
    }
});

module.exports = router;
