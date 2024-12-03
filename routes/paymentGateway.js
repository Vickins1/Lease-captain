const express = require('express');
const router = express.Router();
const axios = require('axios');
const PaymentAccount = require('../models/account');
const Tenant = require('../models/tenant');
const Payment = require('../models/payment');
require('dotenv').config();
const nodemailer = require('nodemailer')

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

router.post('/payment/rent', async (req, res) => {
    const { amount, phoneNumber, paymentMethod } = req.body;
    let tenantId = req.session.tenantId;

    // Debug log to check tenantId value
    console.log('tenantId:', tenantId);

    if (!tenantId || !phoneNumber) {
        req.flash('error', 'Tenant or phone number missing.');
        return res.redirect('/payments');
    }

    try {
        // Fetch tenant and ensure userId is populated
        const tenant = await Tenant.findById(tenantId).populate('property unit userId').lean();
        if (!tenant) throw new Error('Tenant not found.');
        if (!tenant.userId) throw new Error('Tenant does not have an associated user.');

        const rentPaid = parseFloat(amount);
        const transactionId = generateTransactionId('RNT');

        // Fetch the payment account using the userId
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
                req.flash('error', 'Transaction request ID is missing. Payment initiation failed.');
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

            req.flash('info', 'Payment initiated. Awaiting confirmation.');
            req.session.transactionId = transactionId;

            // Pass tenantId when calling pollPaymentStatus
            pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail, tenantId);
            return res.redirect('/payments');
        } else {
            req.flash('error', 'Payment initiation failed. Please try again.');
            return res.redirect('/payments');
        }
    } catch (error) {
        console.error('Failed Payment initiation error:', error);
        req.flash('error', 'Something went wrong. Please try again.');
        return res.redirect('/payments');
    }
});


router.post('/payment/utility', async (req, res) => {
    const { amount, phoneNumber, paymentMethod } = req.body;
    let tenantId = req.session.tenantId;

    // Debug log to check tenantId value
    console.log('tenantId:', tenantId);

    if (!tenantId || !phoneNumber) {
        req.flash('error', 'Tenant or phone number missing.');
        return res.redirect('/payments');
    }

    try {
        // Fetch tenant details, including the unit and property
        const tenant = await Tenant.findById(tenantId).populate('property unit').lean();
        if (!tenant) throw new Error('Tenant not found.');

        const totalPaid = parseFloat(amount) || 0;
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
                req.flash('error', 'Transaction request ID is missing. Payment initiation failed.');
                return res.redirect('/payments');
            }

            // Store payment details in session for status polling
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

            req.flash('info', 'Utility payment initiated. Awaiting confirmation.');
            req.session.transactionId = transactionId;

            // Pass tenantId when calling pollPaymentStatus
            pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail, tenantId); // Passing tenantId here
            return res.redirect('/payments');
        } else {
            req.flash('error', 'Payment initiation failed. Please try again.');
            return res.redirect('/payments');
        }
    } catch (error) {
        console.error('Failed Utility Payment initiation error:', error);
        req.flash('error', 'Something went wrong. Please try again.');
        res.redirect('/payments');
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
            console.log('Payment request successful.');
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

    console.log("Received tenantId:", tenantId);
    if (!tenantId) {
        console.error("No tenantId provided. Cannot proceed with payment polling.");
        return { error: "Tenant ID is required for payment polling." };
    }

    try {
        // Retrieve tenant and owner details
        const tenant = await Tenant.findById(tenantId).populate("owner");
        if (!tenant) {
            throw new Error(`Tenant with ID ${tenantId} does not exist.`);
        }

        if (!tenant.owner) {
            throw new Error(`Owner for tenant with ID ${tenantId} does not exist.`);
        }

        const { email: ownerEmail, phone: ownerPhone } = tenant.owner;

        const interval = setInterval(async () => {
            try {
                const paymentData = req.session.paymentData;

                if (!paymentData) {
                    console.warn("No payment data found in session. Stopping polling.");
                    clearInterval(interval);
                    return;
                }

                console.log("Session Data => Transaction Request ID:", paymentData.transactionRequestId);

                // Exact API request payload as per documentation
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
                        await sendPaymentNotificationEmail(ownerEmail, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                        await sendPaymentNotificationSMS(ownerPhone, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                    } else if (TransactionStatus === "Pending") {
                        console.log("Payment still pending, continuing to poll...");
                    } else {
                        paymentData.status = "failed";
                        updatePaymentData(paymentData, "failed");
                        await savePaymentToDatabase(paymentData);
                        console.warn("Payment failed or canceled.");
                        clearInterval(interval);
                    }
                }
            } catch (error) {
                console.error("Error during payment verification:", error.message);
                clearInterval(interval);
            }

            if (Date.now() - startTime > paymentTimeout) {
                console.warn("Payment verification timeout reached. Stopping polling.");
                clearInterval(interval);
            }
        }, 5000); // Poll every 5 seconds
    } catch (error) {
        console.error("Error initializing polling:", error.message);
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
                <!-- Header -->
                <div style="background-color: #003366; color: #ffffff; padding: 20px; text-align: center;">
                    <h1 style="margin: 0; font-size: 15px;"><strong>Payment Notification</strong></h1>
                </div>
    
                <!-- Body -->
                <div style="padding: 20px;">
                    <p style="font-size: 13px; line-height: 1.6;">Dear <strong>Property Owner</strong>,</p>
                    <p style="font-size: 13px; line-height: 1.6;">We are pleased to inform you that <strong>${tenantName}</strong> has successfully made a payment.</p>
    
                    <p style="font-size: 16px; line-height: 1.6;"><strong>Payment Details:</strong></p>
                    <ul style="font-size: 16px; line-height: 1.6; list-style: none; padding: 0;">
                        <li style="margin-bottom: 8px;"><strong>Payment Type: </strong> ${paymentType}</li>
                        <li><strong>Amount:</strong> Ksh.${amount}</li>
                    </ul>
    
                    <p style="font-size: 16px; line-height: 1.6;">Thank you for using Lease Captain to manage your properties.</p>
                </div>
    
                <!-- Footer -->
                <div style="background-color: #003366; color: #ffffff; padding: 10px; text-align: center; font-size: 14px;">
                    <p style="margin: 0;">Lease Captain | Property Management Simplified</p>
                    <p style="margin: 0;">&copy; ${new Date().getFullYear()} Lease Captain. All Rights Reserved.</p>
                </div>
            </div>
        </div>
    `
    ,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Payment notification email sent successfully.');
    } catch (error) {
        console.error('Error sending payment notification email:', error.message);
    }
};

const sendPaymentNotificationSMS = async (ownerPhone, tenantName, amount, paymentType) => {
    const message = `Dear Property Owner, \n\nWe are pleased to inform you that ${tenantName} has successfully made a payment of Ksh.${amount} for ${paymentType}. \n\nPlease log in to your Lease Captain dashboard for more details.\n\nBest regards,\nLease Captain`;

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
        console.log('Payment notification SMS sent successfully:', response.data);
    } catch (error) {
        console.error('Error sending SMS via UMS API:', error.response?.data || error.message);
    }
};


module.exports = router;
