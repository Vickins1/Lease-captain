const express = require('express');
const router = express.Router();
const axios = require('axios');
const PaymentAccount = require('../models/account');
const Tenant = require('../models/tenant');
const Payment = require('../models/payment');
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
});

const generateTransactionId = (prefix) => {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    return `${prefix}${randomDigits}`;
};

// Server-side validation for phone number
const validatePhoneNumber = (phoneNumber) => {
    const phoneRegex = /^\+254\d{9}$/;
    return phoneRegex.test(phoneNumber);
};

router.post('/payment/rent', async (req, res) => {
    const { amount, phoneNumber, paymentMethod } = req.body;
    const tenantId = req.session.tenantId;

    console.log('tenantId:', tenantId);

    // Input validation
    if (!tenantId) {
        req.flash('error', 'No tenant session found. Please log in again.');
        return res.redirect('/payments');
    }
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        req.flash('error', 'Please enter a valid payment amount greater than 0.');
        return res.redirect('/payments');
    }
    if (!phoneNumber || !validatePhoneNumber(phoneNumber)) {
        req.flash('error', 'Invalid phone number. Use format: +254 followed by 9 digits (e.g., +254712345678).');
        return res.redirect('/payments');
    }
    if (!paymentMethod || paymentMethod !== 'mobilePayment') {
        req.flash('error', 'Invalid payment method. Please select Mobile Payment.');
        return res.redirect('/payments');
    }

    try {
        const tenant = await Tenant.findById(tenantId).populate('property unit userId').lean();
        if (!tenant) throw new Error('Tenant not found.');
        if (!tenant.userId) throw new Error('Tenant does not have an associated user.');

        const rentPaid = parseFloat(amount);
        const transactionId = generateTransactionId('RNT');

        const userPaymentAccount = await PaymentAccount.findOne({ userId: tenant.userId });
        if (!userPaymentAccount) throw new Error('Payment account not found.');

        const payload = {
            api_key: userPaymentAccount.apiKey,
            email: userPaymentAccount.accountEmail,
            account_id: userPaymentAccount.accountId,
            amount: rentPaid,
            msisdn: phoneNumber,
            reference: transactionId,
        };

        const paymentResponse = await sendPaymentRequest(payload);
        if (paymentResponse.success === "200") {
            const transactionRequestId = paymentResponse.tranasaction_request_id;
            if (!transactionRequestId) {
                req.flash('error', 'Payment initiation failed: No transaction request ID received.');
                return res.redirect('/payments');
            }

            req.session.paymentData = {
                tenant: tenantId,
                tenantName: tenant.name,
                property: tenant.property,
                amount: rentPaid,
                totalPaid: rentPaid,
                doorNumber: tenant.unit && tenant.unit.doorNumber ? tenant.unit.doorNumber : 'N/A',
                paymentType: 'rent',
                due: tenant.rentDue || 0,
                datePaid: new Date(),
                method: paymentMethod,
                status: 'pending',
                transactionId,
                transactionRequestId,
            };

            req.flash('info', 'Rent payment initiated successfully. Awaiting confirmation from your mobile device.');
            req.session.transactionId = transactionId;

            pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail, tenantId);
            return res.redirect('/payments');
        } else {
            req.flash('error', 'Payment initiation failed. Please check your details and try again.');
            return res.redirect('/payments');
        }
    } catch (error) {
        console.error('Rent Payment Initiation Error:', error.message);
        req.flash('error', `An error occurred: ${error.message}. Please try again later.`);
        return res.redirect('/payments');
    }
});

router.post('/payment/utility', async (req, res) => {
    const { amount, phoneNumber, paymentMethod } = req.body;
    const tenantId = req.session.tenantId;

    console.log('tenantId:', tenantId);

    // Input validation
    if (!tenantId) {
        req.flash('error', 'No tenant session found. Please log in again.');
        return res.redirect('/payments');
    }
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        req.flash('error', 'Please enter a valid payment amount greater than 0.');
        return res.redirect('/payments');
    }
    if (!phoneNumber || !validatePhoneNumber(phoneNumber)) {
        req.flash('error', 'Invalid phone number. Use format: +254 followed by 9 digits (e.g., +254712345678).');
        return res.redirect('/payments');
    }
    if (!paymentMethod || paymentMethod !== 'mobilePayment') {
        req.flash('error', 'Invalid payment method. Please select Mobile Payment.');
        return res.redirect('/payments');
    }

    try {
        const tenant = await Tenant.findById(tenantId).populate('property unit userId').lean();
        if (!tenant) throw new Error('Tenant not found.');

        const totalPaid = parseFloat(amount);
        const transactionId = generateTransactionId('UTL');

        const userPaymentAccount = await PaymentAccount.findOne({ userId: tenant.userId });
        if (!userPaymentAccount) throw new Error('Payment account not found.');

        const payload = {
            api_key: userPaymentAccount.apiKey,
            email: userPaymentAccount.accountEmail,
            account_id: userPaymentAccount.accountId,
            amount: totalPaid,
            msisdn: phoneNumber,
            reference: transactionId,
        };

        const paymentResponse = await sendPaymentRequest(payload);
        if (paymentResponse.success === "200") {
            const transactionRequestId = paymentResponse.tranasaction_request_id;
            if (!transactionRequestId) {
                req.flash('error', 'Payment initiation failed: No transaction request ID received.');
                return res.redirect('/payments');
            }

            req.session.paymentData = {
                tenant: tenantId,
                tenantName: tenant.name,
                property: tenant.property,
                amount: totalPaid,
                totalPaid: totalPaid,
                doorNumber: tenant.unit && tenant.unit.doorNumber ? tenant.unit.doorNumber : 'N/A',
                paymentType: 'utility',
                due: tenant.utilityDue || 0,
                datePaid: new Date(),
                method: paymentMethod,
                status: 'pending',
                transactionId,
                transactionRequestId,
            };

            req.flash('info', 'Utility payment initiated successfully. Awaiting confirmation from your mobile device.');
            req.session.transactionId = transactionId;

            pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail, tenantId);
            return res.redirect('/payments');
        } else {
            req.flash('error', 'Payment initiation failed. Please check your details and try again.');
            return res.redirect('/payments');
        }
    } catch (error) {
        console.error('Utility Payment Initiation Error:', error.message);
        req.flash('error', `An error occurred: ${error.message}. Please try again later.`);
        return res.redirect('/payments');
    }
});

async function sendPaymentRequest(payload) {
    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/intiatestk',
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (response && response.status === 200) {
            console.log('Payment request successful:', response.data);
            return response.data;
        } else {
            console.error('Payment request failed: Invalid response status:', response.status);
            return { success: false, error: `Unexpected response status: ${response.status}` };
        }
    } catch (err) {
        if (err.response) {
            console.error('Server error:', err.response.data);
            return { success: false, error: err.response.data.message || 'Server error occurred.' };
        } else if (err.request) {
            console.error('Network error: No response received:', err.request);
            return { success: false, error: 'No response from server. Please check your network connection.' };
        } else {
            console.error('Payment request failed:', err.message);
            return { success: false, error: err.message || 'Unknown error occurred during payment request.' };
        }
    }
}

const pollPaymentStatus = async (req, api_key, email, tenantId) => {
    const paymentTimeout = 30000;
    const startTime = Date.now();

    console.log("Received tenantId for polling:", tenantId);
    if (!tenantId) {
        console.error("No tenantId provided. Cannot proceed with payment polling.");
        return { error: "Tenant ID is required for payment polling." };
    }

    try {
        const tenant = await Tenant.findById(tenantId).populate("owner userId");
        if (!tenant) throw new Error(`Tenant with ID ${tenantId} does not exist.`);
        if (!tenant.owner) throw new Error(`Owner for tenant with ID ${tenantId} does not exist.`);
        if (!tenant.userId) throw new Error(`User for tenant with ID ${tenantId} does not exist.`);

        const { email: ownerEmail, phone: ownerPhone } = tenant.owner;
        const { email: tenantEmail, phone: tenantPhone } = tenant.userId;

        const interval = setInterval(async () => {
            try {
                const paymentData = req.session.paymentData;

                if (!paymentData) {
                    console.warn("No payment data found in session. Stopping polling.");
                    clearInterval(interval);
                    return;
                }

                console.log("Session Data => Transaction Request ID:", paymentData.transactionRequestId);

                const verificationPayload = {
                    api_key,
                    email,
                    tranasaction_request_id: paymentData.transactionRequestId,
                };

                console.log("Verifying payment with payload:", verificationPayload);

                const response = await axios.post(
                    "https://api.umeskiasoftwares.com/api/v1/transactionstatus",
                    verificationPayload,
                    { headers: { "Content-Type": "application/json" } }
                );

                const responseData = response.data;
                console.log("Verification response:", responseData);

                if (responseData) {
                    const { ResultCode, TransactionStatus, TransactionCode } = responseData;

                    if (TransactionStatus === "Completed" && ResultCode === "200" && TransactionCode === "0") {
                        paymentData.status = "completed";
                        clearInterval(interval);
                        console.log("Payment completed.");

                        updatePaymentData(paymentData, "completed");
                        await savePaymentToDatabase(paymentData);
                        await updateTenantDues(tenantId, paymentData.paymentType, paymentData.amount);
                        await sendPaymentNotificationEmail(ownerEmail, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                        await sendPaymentNotificationSMS(ownerPhone, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                        await sendTenantConfirmationEmail(tenantEmail, paymentData);
                        await sendTenantConfirmationSMS(tenantPhone, paymentData);

                        req.flash('success', `${paymentData.paymentType.charAt(0).toUpperCase() + paymentData.paymentType.slice(1)} payment of Ksh.${paymentData.amount.toFixed(2)} completed successfully!`);
                    } else if (TransactionStatus === "Pending") {
                        console.log("Payment still pending, continuing to poll...");
                    } else {
                        paymentData.status = "failed";
                        updatePaymentData(paymentData, "failed");
                        await savePaymentToDatabase(paymentData);
                        console.warn("Payment failed or canceled.");
                        req.flash('error', 'Payment failed or was canceled. Please try again.');
                        clearInterval(interval);
                    }
                }
            } catch (error) {
                console.error("Error during payment verification:", error.message);
                req.flash('error', 'An error occurred while verifying payment. Please try again.');
                clearInterval(interval);
            }

            if (Date.now() - startTime > paymentTimeout) {
                console.warn("Payment verification timeout reached. Stopping polling.");
                req.flash('error', 'Payment confirmation timed out. Please check your mobile device and try again if needed.');
                clearInterval(interval);
            }
        }, 5000);
    } catch (error) {
        console.error("Error initializing polling:", error.message);
        req.flash('error', `Polling error: ${error.message}. Please try again.`);
    }
};

const updatePaymentData = (paymentData, status) => {
    if (status === "completed") {
        if (paymentData.paymentType === "rent") {
            paymentData.rentPaid = paymentData.amount;
            paymentData.utilityPaid = 0;
        } else if (paymentData.paymentType === "utility") {
            paymentData.utilityPaid = paymentData.amount;
            paymentData.rentPaid = 0;
        } else {
            paymentData.rentPaid = 0;
            paymentData.utilityPaid = 0;
        }
    } else {
        paymentData.rentPaid = 0;
        paymentData.utilityPaid = 0;
    }
};

const savePaymentToDatabase = async (paymentData) => {
    try {
        const payment = new Payment(paymentData);
        await payment.save();
        console.log(`Payment saved with status: ${paymentData.status}`);
    } catch (error) {
        console.error("Error saving payment to database:", error.message);
        throw error; // Re-throw to handle in caller
    }
};

const updateTenantDues = async (tenantId, paymentType, amount) => {
    try {
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) throw new Error('Tenant not found.');

        if (paymentType === 'rent') {
            tenant.rentDue = Math.max(0, (tenant.rentDue || 0) - amount);
        } else if (paymentType === 'utility') {
            tenant.utilityDue = Math.max(0, (tenant.utilityDue || 0) - amount);
        }

        await tenant.save();
        console.log(`Tenant dues updated: ${paymentType} reduced by ${amount}`);
    } catch (error) {
        console.error('Error updating tenant dues:', error.message);
        throw error;
    }
};

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

const sendPaymentNotificationSMS = async (ownerPhone, tenantName, amount, paymentType) => {
    const message = `Dear Property Owner,\n\n${tenantName} has made a ${paymentType} payment of Ksh.${amount.toFixed(2)}. Log in to Lease Captain for details.\n\nBest regards,\nLease Captain`;

    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',
            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message,
                phone: ownerPhone,
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log('Payment notification SMS sent successfully to owner:', response.data);
    } catch (error) {
        console.error('Error sending SMS to owner via UMS API:', error.response?.data || error.message);
    }
};

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
                            <td style="padding: 8px;">${paymentData.property.name || 'N/A'}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Door Number:</strong></td>
                            <td style="padding: 8px;">${paymentData.doorNumber}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;"><strong>Payment Method:</strong></td>
                            <td style="padding: 8px;">${paymentData.method}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px;"><strong>Remaining Due:</strong></td>
                            <td style="padding: 8px;">Ksh.${Math.max(0, paymentData.due - paymentData.amount).toFixed(2)}</td>
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

const sendTenantConfirmationSMS = async (tenantPhone, paymentData) => {
    const message = `Dear ${paymentData.tenantName},\nYour ${paymentData.paymentType} payment of Ksh.${paymentData.amount.toFixed(2)} is confirmed.\nTransaction ID: ${paymentData.transactionId}\nDate: ${new Date(paymentData.datePaid).toLocaleDateString()}\nProperty: ${paymentData.property.name || 'N/A'}\nDoor: ${paymentData.doorNumber}\nRemaining Due: Ksh.${Math.max(0, paymentData.due - paymentData.amount).toFixed(2)}.\nThank you,\nLease Captain`;

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

module.exports = router;