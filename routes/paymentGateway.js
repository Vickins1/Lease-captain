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

        const { email: ownerEmail, phone: ownerPhone, username: owneruserName } = tenant.owner;

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
                        await sendPaymentNotificationEmail(ownerEmail, owneruserName, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                        await sendPaymentNotificationSMS(ownerPhone, owneruserName, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
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
        <div style="font-family: Arial, sans-serif; color: #003366; background-color: #ffffff; padding: 20px; border: 1px solid #003366; border-radius: 8px;">
            <h1 style="color: #003366; border-bottom: 2px solid #003366; padding-bottom: 10px;">Payment Notification</h1>
            <p>Dear Property Owner,</p>
            <p>We are pleased to inform you that <strong>${tenantName}</strong> has successfully completed a payment.</p>
            <div style="margin: 20px 0; padding: 15px; border: 1px solid #003366; background-color: #f9f9f9; border-radius: 5px;">
                <h3 style="color: #003366; margin: 0 0 10px;">Payment Details</h3>
                <ul style="list-style: none; padding: 0; margin: 0; color: #333;">
                    <li><strong>Payment Type:</strong> ${paymentType}</li>
                    <li><strong>Amount:</strong> $${amount}</li>
                </ul>
            </div>
            <p>Thank you for trusting Lease Captain to manage your properties. If you have any questions, feel free to contact our support team.</p>
            <footer style="margin-top: 30px; border-top: 1px solid #003366; padding-top: 10px; text-align: center; color: #666;">
                <p style="font-size: 12px;">Lease Captain Team<br>Contact Us: <a href="mailto:support@leasecaptain.com" style="color: #003366;">support@leasecaptain.com</a></p>
                <p style="font-size: 12px;">&copy; ${new Date().getFullYear()} Lease Captain. All Rights Reserved.</p>
            </footer>
        </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Payment notification email sent successfully.');
    } catch (error) {
        console.error('Error sending payment notification email:', error.message);
    }
};

const sendPaymentNotificationSMS = async (owneruserName, ownerPhone, tenantName, amount, paymentType) => {
    const message = `Dear ${owneruserName},\n\nWe are pleased to notify you that ${tenantName} has successfully made a payment of $${amount} for ${paymentType}. Please log in to your dashboard for more details.\n\nThank you for using Lease Captain!`;

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
