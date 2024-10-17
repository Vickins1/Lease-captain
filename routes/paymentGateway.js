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
           console.log('HERE Payment initiation response:', paymentResponse);
           console.log("CHECKING STATUS : " + paymentResponse.success)
           if (paymentResponse.success === "200") {
               const transactionRequestId = paymentResponse.tranasaction_request_id;
               console.log("RESPONSE TXT : " + transactionRequestId)
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
               console.log("TXT "+transactionId)
               req.flash('info', 'Payment initiated. Awaiting confirmation.');
               req.session.transactionId = transactionId;
               console.log("TXT CHCKER CALLED BEFOR")
               // Start polling for payment status
               pollPaymentStatus(req, userPaymentAccount.apiKey, userPaymentAccount.accountEmail);
               console.log("TXT CHCKER CALLED")
               return res.redirect('/payments');
           } else {
              console.log("FAILED TO CHECK")
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
               console.log("SESSON DATA => "+ paymentData.transactionRequestId)
               if (!paymentData) {
                   clearInterval(interval);
                   return;
               }
   
               const verificationPayload = {
                   api_key,
                   email,
                   tranasaction_request_id : paymentData.transactionRequestId,
               };
   
               console.log('Verifying payment with payload:', verificationPayload);
   
               const response = await axios.post('https://api.umeskiasoftwares.com/api/v1/transactionstatus', verificationPayload, {
                   headers: {
                       'Content-Type': 'application/json',
                   },
               });
               console.log('Verification response:', response.data);
   
               if (response.data && response.data.ResultCode === '200') {
                   paymentData.status = 'completed';
   
                   const payment = new Payment(paymentData);
                   await payment.save();
   
                   console.log(`Payment verified and saved successfully: ${payment.transactionId}`);
                   clearInterval(interval);

               } else if (response.data && response.data.ResultCode !== '200') {
                   paymentData.status = 'failed';
   
                   const payment = new Payment(paymentData);
                   await payment.save();
   
                   console.warn(`Payment verification failed and saved as failed: ${payment.transactionId}`);
                   clearInterval(interval);
               }
           } catch (error) {
               if (error.response && error.response.status === 404) {
                   console.error(`Verification endpoint not found: ${error.response.status}`);
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
           // Fetch tenant details, including the unit
           const tenant = await Tenant.findById(tenantId).populate('unit').lean();
           if (!tenant) throw new Error('Tenant not found.');
   
           const totalPaid = parseFloat(amount) || 0;
           const newUtilityDue = (tenant.utilityDue || 0) - totalPaid;
           tenant.utilityDue = newUtilityDue;
           await Tenant.findByIdAndUpdate(tenantId, { utilityDue: newUtilityDue });
   
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
   
           const payment = await Payment.create({
               tenant: tenantId,
               tenantName: tenant.name,
               property: tenant.property,
               amount: totalPaid,
               totalPaid: totalPaid,
               doorNumber: tenant.unit.doorNumber || 'N/A', // Ensure doorNumber is populated
               paymentType: 'utility',
               due: newUtilityDue,
               datePaid: new Date(),
               method: paymentMethod,
               status: paymentResponse.success ? 'pending' : 'failed',
               transactionId,
           });
   
           if (paymentResponse.success) {
               // Start polling for payment status
               pollPaymentStatus(payment, userPaymentAccount.apiKey);
               req.flash('success', 'Utility payment initiated successfully.');
           } else {
               req.flash('error', 'Payment initiation failed. Please try again.');
           }
   
           return res.redirect('/payments');
       } catch (error) {
           handlePaymentError(error, req, res);
       }
   });
   

// Handle Payment Errors
function handlePaymentError(error, req, res) {
    console.error('Payment error:', error);
    req.flash('error', 'An error occurred while processing your payment. Please try again later.');
    res.redirect('/payments');
}

module.exports = router;
