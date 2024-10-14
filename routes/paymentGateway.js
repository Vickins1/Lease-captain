const express = require('express');
const router = express.Router();
const axios = require('axios');
const PaymentAccount = require('../models/account');
require('dotenv').config();
const Tenant = require('../models/tenant');

const UMS_API_BASE_URL = 'https://api.umeskiasoftwares.com/api/v1';

router.post('/payment/rent', async (req, res) => {
       const { amount, phoneNumber } = req.body;
       const tenantId = req.session.tenantId;

       if (!tenantId) {
              return res.status(401).json({ message: 'Unauthorized: Tenant not found in session.' });
       }

       if (!phoneNumber) {
              return res.status(400).json({ message: 'Phone number is required.' });
       }

       try {
              const tenant = await Tenant.findById(tenantId);

              if (!tenant) {
                     return res.status(404).json({ message: 'Tenant not found.' });
              }

              const creatorId = tenant.userId;
              console.log('Creator ID:', creatorId);

              const userPaymentAccount = await PaymentAccount.findOne({ userId: creatorId });

              if (!userPaymentAccount) {
                     return res.status(404).json({ message: 'Payment account for creator not found.' });
              }

              console.log(userPaymentAccount);

              // Prepare the payload
              const payload = {
                     api_key: userPaymentAccount.apiKey,
                     email: userPaymentAccount.accountEmail,
                     account_id: userPaymentAccount.accountId,
                     amount: amount,
                     msisdn: phoneNumber,
                     reference: Date.now().toString(),
              };
              try {
                     // Send the POST request with timeout
                     const response = await axios.post('https://api.umeskiasoftwares.com/api/v1/intiatestk', payload, {
                            headers: {
                                   'Content-Type': 'application/json',
                            },
                            timeout: 10000,
                     });

                     // Log and return the response data
                     console.log('API Response:', response.data);
                     return res.json(response.data);

              } catch (error) {
                     // Log error details
                     console.error('Error making payment:', error.message);

                     // Log detailed error response if available
                     if (error.response) {
                            console.error('Error response data:', error.response.data);
                            return res.status(error.response.status).json(error.response.data);
                     } else {
                            return res.status(500).json({ error: 'An unexpected error occurred' });
                     }
              }
       } catch (error) {
              if (error.response) {
                     console.error('STK Push failed with response:', error.response.data);
                     return res.status(error.response.status).json({ message: error.response.data.message || 'Payment failed' });
              } else if (error.request) {
                     console.error('No response received:', error.request);
                     return res.status(500).json({ message: 'No response from payment server. Please try again.' });
              } else {
                     console.error('Error initiating STK push:', error.message);
                     return res.status(500).json({ message: 'Payment initiation failed. Please try again.' });
              }
       }
});


// Utility payment endpoint
router.post('/payment/utility', async (req, res) => {
       const { amount, phoneNumber } = req.body;

       const tenantId = req.session.tenantId;

       if (!tenantId) {
              return res.status(401).json({ message: 'Unauthorized: Tenant not found in session.' });
       }

       try {
              const userPaymentAccount = await PaymentAccount.findOne({ userId: tenantId });

              if (!userPaymentAccount) {
                     return res.status(404).json({ message: 'Payment account not found.' });
              }

              const response = await axios.post(`${UMS_API_BASE_URL}/intiatestk`, {
                     api_key: userPaymentAccount.apiKey,
                     email: userPaymentAccount.email,
                     account_id: userPaymentAccount.accountId,
                     amount: amount,
                     msisdn: process.env.CUSTOMER_PHONE,
                     reference: Date.now().toString()
              });

              return res.status(200).json({ message: response.data.massage });
       } catch (error) {
              console.error('Error initiating STK push:', error);
              return res.status(500).json({ message: 'Payment initiation failed. Please try again.' });
       }
});


module.exports = router;
