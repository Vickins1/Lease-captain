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

// Utility function to send payment requests
async function sendPaymentRequest(payload) {
    try {
        const response = await axios.post(process.env.INITIATE_STK_URL, payload);
        console.log('Payment request successful.');
        return response.data;
    } catch (err) {
        console.error('Payment request failed:', err.message);
        return { success: false, error: err.message };
    }
}

// STK Push initiation route
router.post('/payment/rent', async (req, res) => {
       const { amount, phoneNumber, paymentMethod } = req.body;
       const tenantId = req.session.tenantId;
   
       if (!tenantId || !phoneNumber) {
           req.flash('error', 'Tenant or phone number missing.');
           return res.redirect('/payments');
       }
   
       try {
           const tenant = await Tenant.findById(tenantId).populate('property unit').lean();
           if (!tenant) throw new Error('Tenant not found.');
   
           const rentPaid = parseFloat(amount);
           const transactionId = generateTransactionId('RNT-');
   
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
           console.log('Payment initiation response:', paymentResponse);
           if (paymentResponse.success === "200") {
               const transactionRequestId = paymentResponse.tranasaction_request_id;
               if (!transactionRequestId) {
                   req.flash('error', 'Transaction request ID is missing. Payment initiation failed.');
                   return res.redirect('/payments');
               }
   
               // Store payment details in the session
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
               // Start polling for payment status
               pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail);
               return res.redirect('/payments');
           } else {
               req.flash('error', 'Payment initiation failed. Please try again.');
               return res.redirect('/payments');
           }
       } catch (error) {
           console.error('Failed Payment initiation error:', error);
           req.flash('error', 'Something went wrong. Please try again.');
           res.redirect('/payments');
       }
   });
   
// Function to periodically check the status of a payment
function pollPaymentStatus(req, api_key, email) {
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
                   tranasaction_request_id: paymentData.transactionRequestId,
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
   
                   if (TransactionStatus === 'Completed' && ResultCode === '200') {
                       paymentData.status = 'completed';
                       console.log('Payment completed.');
   
                   } else if (TransactionStatus === 'Pending') {
                       paymentData.status = 'pending';
                       console.log('Payment still pending, continuing to poll...');
                       return; 
                   } else {
                       paymentData.status = 'failed';
                       console.warn('Payment failed or canceled.');
                   }
   
                   // Save payment data to the database
                   const payment = new Payment(paymentData);
                   await payment.save();
   
                   console.log(`Payment saved with status: ${paymentData.status}`);
                   clearInterval(interval);
               }
           } catch (error) {
               if (error.response && error.response.status === 404) {
                   console.error('Verification endpoint not found:', error.response.status);
                   clearInterval(interval);
               } else {
                   console.error('Error during payment verification:', error.message);
               }
           }
       }, 5000);
   }
   
// Utility Payment Route
router.post('/payment/utility', async (req, res) => {
       const { amount, phoneNumber, paymentMethod } = req.body;
       const tenantId = req.session.tenantId;
   
       if (!tenantId || !phoneNumber) {
           req.flash('error', 'Tenant or phone number missing.');
           return res.redirect('/payments');
       }
   
       try {
           // Fetch tenant details, including the unit and property
           const tenant = await Tenant.findById(tenantId).populate('property unit').lean();
           if (!tenant) throw new Error('Tenant not found.');
   
           const totalPaid = parseFloat(amount) || 0;
           const transactionId = generateTransactionId('UTL-');
   
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
           console.log('Payment initiation response:', paymentResponse);
   
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
   
               // Start polling for payment status
               pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail);
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
   

module.exports = router;
