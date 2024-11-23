const express = require('express');
const router = express.Router();
const axios = require('axios');
const PaymentAccount = require('../models/account');
const Tenant = require('../models/tenant');
const Payment = require('../models/payment');
require('dotenv').config();

const generateTransactionId = (prefix) => {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    return `${prefix}${randomDigits}`;
};

// Utility Payment Route
router.post('/payment/utility', async (req, res) => {
    const { amount, phoneNumber, paymentMethod } = req.body;
    const tenantId = req.session.tenantId; // Get tenant ID from session

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

        console.log('API Key ' + userPaymentAccount.apiKey + ' EMEIL : ' + userPaymentAccount.accountEmail + ' Account id' + userPaymentAccount.accountEmail)

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
            const transactionRequestId = paymentResponse.tranasction_request_id;
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
            pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail, tenantId);
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

// Rent Payment Route (similar to utility)
router.post('/payment/rent', async (req, res) => {
    const { amount, phoneNumber, paymentMethod } = req.body;
    const tenantId = req.session.tenantId; // Get tenant ID from session

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
            const transactionRequestId = paymentResponse.tranasction_request_id;
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
    const paymentTimeout = 10000; 
    const startTime = Date.now();

    // Log the tenantId for debugging
    console.log('Received tenantId:', tenantId);

    if (!tenantId) {
        console.error('No tenantId provided. Cannot proceed with payment polling.');
        return { error: 'Tenant ID is required for payment polling.' };
    }

    try {
        // Retrieve owner details before starting the polling
        const tenant = await Tenant.findById(tenantId).populate('owner');

        if (!tenant) {
            console.error(`Tenant not found for ID: ${tenantId}`);
            throw new Error(`Tenant with ID ${tenantId} does not exist.`);
        }

        if (!tenant.owner) {
            console.error(`Owner not found for tenant ID: ${tenantId}`);
            throw new Error(`Owner for tenant with ID ${tenantId} does not exist.`);
        }

        const ownerEmail = tenant.owner.email;
        const ownerPhone = tenant.owner.phone;

        const interval = setInterval(async () => {
            try {
                const paymentData = req.session.paymentData;

                if (!paymentData) {
                    console.warn('No payment data found in session. Stopping polling.');
                    clearInterval(interval);
                    return;
                }

                console.log("Session Data => Transaction Request ID:", paymentData.transactionRequestId);

                const verificationPayload = {
                    api_key,
                    email,
                    tranasction_request_id: paymentData.transactionRequestId,
                };

                console.log('Verifying payment with payload:', verificationPayload);

                const response = await axios.post(
                    'https://api.umeskiasoftwares.com/api/v1/transactionstatus',
                    verificationPayload,
                    { headers: { 'Content-Type': 'application/json' } }
                );

                console.log('Verification response:', response.data);

                if (response.data) {
                    const { ResultCode, TransactionStatus } = response.data;

                    // Determine payment status based on the response
                    if (TransactionStatus === 'Completed' && ResultCode === '200') {
                        paymentData.status = 'completed';
                        clearInterval(interval);
                        console.log('Payment completed.');

                        // Only update rentPaid or utilityPaid for completed payments
                        if (paymentData.paymentType === 'rent') {
                            paymentData.rentPaid = paymentData.amount;
                            paymentData.utilityPaid = 0;
                        } else if (paymentData.paymentType === 'utility') {
                            paymentData.utilityPaid = paymentData.amount;
                            paymentData.rentPaid = 0;
                        } else {
                            paymentData.rentPaid = 0;
                            paymentData.utilityPaid = 0;
                        }

                        // Save payment data to the database
                        const payment = new Payment(paymentData);
                        await payment.save();
                        console.log(`Payment saved with status: ${paymentData.status}`);

                        // Send email and SMS notifications
                        await sendPaymentNotificationEmail(ownerEmail, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                        await sendPaymentNotificationSMS(ownerPhone, paymentData.tenantName, paymentData.amount, paymentData.paymentType);
                    } else if (TransactionStatus === 'Pending') {
                        paymentData.status = 'pending';
                        console.log('Payment still pending, continuing to poll...');
                        return;
                    } else {
                        paymentData.status = 'failed';
                        paymentData.rentPaid = 0;
                        paymentData.utilityPaid = 0;
                        console.warn('Payment failed or canceled.');

                        // Save failed payment data to the database
                        const payment = new Payment(paymentData);
                        await payment.save();
                        console.log(`Payment saved with status: ${paymentData.status}`);
                    }
                }
            } catch (error) {
                // Handle different error cases and stop polling
                if (error.response && error.response.status === 404) {
                    console.error('Verification endpoint not found:', error.response.status);
                } else {
                    console.error('Error during payment verification:', error.message);
                }
                clearInterval(interval);
            }

            // Stop polling if timeout is reached
            if (Date.now() - startTime > paymentTimeout) {
                console.warn('Payment verification timeout reached. Stopping polling.');
                clearInterval(interval);
            }
        }, 5000); // Poll every 5 seconds
    } catch (error) {
        console.error('Error initializing polling:', error.message);
    }
};



// Send payment notification email to the owner
const sendPaymentNotificationEmail = async (ownerEmail, tenantName, amount, paymentType) => {
    const mailOptions = {
        from: `"Lease Captain" <${process.env.EMAIL_USERNAME}>`,
        to: ownerEmail,
        subject: `Payment Notification: ${tenantName} (${paymentType})`,
        html: `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Notification</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f4f4f4;
        margin: 0;
        padding: 0;
        color: #333;
      }
      .container {
        width: 100%;
        max-width: 600px;
        margin: 20px auto;
        background-color: #ffffff;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
      }
      .header {
        background-color: #003366;
        padding: 20px;
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
      .content p {
        margin: 10px 0;
      }
      .footer {
        text-align: center;
        color: #777;
        font-size: 12px;
        margin-top: 20px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Payment Notification</h1>
      </div>
      <div class="content">
        <p>Dear Owner,</p>
        <p>We are pleased to inform you that <strong>${tenantName}</strong> has successfully made a payment.</p>
        <p><strong>Details:</strong></p>
        <ul>
          <li>Payment Type: ${paymentType}</li>
          <li>Amount: $${amount}</li>
        </ul>
        <p>Thank you for using Lease Captain to manage your properties.</p>
        <p>Best regards,<br>Lease Captain Team</p>
      </div>
      <div class="footer">
        &copy; 2024 Lease Captain. All rights reserved.
      </div>
    </div>
  </body>
  </html>
      `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Payment notification email sent successfully.');
    } catch (error) {
        console.error('Error sending payment notification email:', error);
    }
};

// Send payment notification SMS to the owner
const sendPaymentNotificationSMS = async (ownerPhone, tenantName, amount, paymentType) => {
    const message = `Payment Alert: ${tenantName} has paid $${amount} for ${paymentType}. Check your dashboard for more details. - Lease Captain`;

    try {
        const response = await axios.post(
            'https://api.umeskiasoftwares.com/api/v1/sms',
            {
                api_key: "VEpGOTVNTlY6dnUxaG5odHA=",
                email: "vickinstechnologies@gmail.com",
                Sender_Id: "UMS_SMS",
                message: message,
                phone: ownerPhone
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log('Payment notification SMS sent successfully:', response.data);
    } catch (error) {
        console.error('Error sending SMS via UMS API:', error.response ? error.response.data : error.message);
    }
};


module.exports = router;
