const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');
const Reminder = require('../models/reminder');
const Tenant = require('../models/tenant');
const TopUp = require('../models/topups');
const { checkRole, isTenancyManager } = require('../middleware');

// Function to send reminder via SMS using Umeskia Softwares API
async function sendReminderSMS(recipientPhone, title, message) {
    try {
        const smsContent = `Reminder: ${title}\n${message}`;
        const smsApiUrl = 'https://api.umeskiasoftwares.com/api/v1/sms';
        const senderId = process.env.UMS_SENDER_ID;

        const response = await axios.post(smsApiUrl, {
            api_key: process.env.UMS_API_KEY,
            email: process.env.UMS_EMAIL,
            Sender_Id: senderId,
            message: smsContent,
            phone: recipientPhone
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success === '200') {
            console.log(`SMS sent successfully to ${recipientPhone}:`, response.data);
        } else {
            console.error(`Error sending SMS: ${response.data.massage}`);
            throw new Error('Failed to send SMS');
        }
    } catch (error) {
        console.error('Error sending reminder SMS:', error.response ? error.response.data : error.message);
        throw new Error('Failed to send reminder SMS');
    }
}

// Function to send reminder via email using Nodemailer
async function sendReminderEmailNodemailer(recipientEmail, title, message) {
    try {
        const emailContent = `Reminder: ${title}\n${message}`;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: recipientEmail,
            subject: `Reminder: ${title}`,
            text: emailContent
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Reminder email sent to ${recipientEmail}: ${info.messageId}`);
    } catch (error) {
        console.error('Error sending reminder email with Nodemailer:', error);
        throw new Error('Failed to send reminder email');
    }
}

// Function to send reminders to tenants via SMS or email
async function sendRemindersToTenants(req, res) {
    try {
        const reminders = await Reminder.find({ userId: req.user._id }).populate('templateId');

        if (reminders.length === 0) {
            req.flash('error', 'No reminders found for the logged-in user.');
            return res.redirect('/sms&email');
        }

        for (const reminder of reminders) {
            const tenants = await Tenant.find({ owner: req.user._id });

            if (tenants.length === 0) {
                console.log(`No tenants found for the reminder with title: ${reminder.title}`);
                continue;
            }

            for (const tenant of tenants) {
                if (tenant.email) {
                    await sendReminderEmailNodemailer(tenant.email, reminder.title, reminder.message);
                    console.log(`Email sent to tenant ${tenant.name} at ${tenant.email}`);
                } else if (tenant.phone) {
                    await sendReminderSMS(tenant.phone, reminder.title, reminder.message);
                    console.log(`SMS sent to tenant ${tenant.name} at ${tenant.phone}`);
                } else {
                    console.error(`No contact information found for tenant ${tenant.name}`);
                }
            }
        }

        req.flash('success', 'Reminders sent successfully to all tenants.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error sending reminders to tenants:', error);
        req.flash('error', 'Error sending reminders to tenants.');
        res.redirect('/sms&email');
    }
}

// Route to trigger sending reminders
router.post('/reminders/send', isTenancyManager, sendRemindersToTenants);

// Function to fetch SMS credit balance using Umeskia Softwares API
async function checkSMSCreditBalance() {
    try {
        const smsCreditUrl = 'https://api.umeskiasoftwares.com/api/v1/smsbalance';
        const response = await axios.post(smsCreditUrl, {
            api_key: process.env.UMS_API_KEY,
            email: process.env.UMS_EMAIL
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success === '200') {
            const creditBalance = response.data.creditBalance;
            console.log(`Current SMS credit balance: ${creditBalance}`);
            return creditBalance;
        } else {
            console.error('Error fetching SMS credit balance:', response.data.message);
            throw new Error('Failed to fetch SMS credit balance');
        }
    } catch (error) {
        console.error('Error fetching SMS credit balance:', error.response ? error.response.data : error.message);
        throw new Error('Failed to fetch SMS credit balance');
    }
}

// Route to display SMS credit balance to the user
router.get('/sms/credit-balance', async (req, res) => {
    try {
        const creditBalance = await checkSMSCreditBalance();
        res.render('smsCreditBalance', {
            creditBalance,
            success: req.flash('success'),
            error: req.flash('error')
        });
    } catch (error) {
        console.error('Error displaying SMS credit balance:', error);
        req.flash('error', 'Error fetching SMS credit balance.');
        res.redirect('/sms&email');
    }
});

// Route to handle SMS top-up requests
router.post('/topups', isTenancyManager, async (req, res) => {
    const { amount, phone } = req.body;

    if (!amount || !phone) {
        req.flash('error', 'Please provide both the amount and the phone number.');
        return res.redirect('/top-ups');
    }

    try {
        const payload = {
            api_key: process.env.UMS_API_KEY,
            email: process.env.UMS_EMAIL,
            Sender_Id: process.env.UMS_SENDER_ID || 'UMS_SMS',
            amount,
            phone
        };

        const response = await axios.post('https://api.umeskiasoftwares.com/api/v1/sms', payload, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (response.data.success === '200') {
            const newTopUp = new TopUp({
                amount,
                phone,
                createdBy: req.user._id
            });
            await newTopUp.save();

            req.flash('success', 'SMS top-up successful!');
            res.redirect('/sms&email');
        } else {
            req.flash('error', 'Top-up failed: ' + response.data.message);
            res.redirect('/sms&email');
        }
    } catch (error) {
        console.error('Error during SMS top-up:', error);
        req.flash('error', 'Something went wrong during the SMS top-up. Please try again.');
        res.redirect('/sms&email');
    }
});

router.post('/topups/:id/delete', isTenancyManager, async (req, res) => {
    try {
        const { id } = req.params;
        await TopUp.findByIdAndDelete(id);
        req.flash('success', 'Top-up deleted successfully.');
        res.redirect('/sms&email');
    } catch (error) {
        console.error('Error deleting top-up:', error);
        req.flash('error', 'Error deleting the top-up.');
        res.redirect('/sms&email');
    }
});

// Route to send SMS manually
router.post('/send-sms', isTenancyManager, async (req, res) => {
       const { phone, smsMessage } = req.body;
   
       // Check if phone and message are provided
       if (!phone || !smsMessage) {
           req.flash('error', 'Please provide both the phone number and the message.');
           return res.redirect('/sms&email');
       }
   
       try {
           // Prepare SMS data
           const payload = {
               api_key: process.env.UMS_API_KEY,
               email: process.env.UMS_EMAIL,
               Sender_Id: process.env.UMS_SENDER_ID || 'UMS_SMS',
               message: smsMessage,
               phone: phone
           };
   
           // Send the SMS using Umeskia API
           const smsApiUrl = 'https://api.umeskiasoftwares.com/api/v1/sms';
           const response = await axios.post(smsApiUrl, payload, {
               headers: {
                   'Content-Type': 'application/json',
               },
           });
   
           // Check if the SMS was sent successfully
           if (response.data.success === '200') {
               req.flash('success', `SMS sent successfully to ${phone}.`);
           } else {
               req.flash('error', `Failed to send SMS: ${response.data.massage}`);
           }
           res.redirect('/sms&email');
       } catch (error) {
           console.error('Error sending SMS manually:', error);
           req.flash('error', 'Failed to send SMS. Please try again.');
           res.redirect('/sms&email');
       }
   });
   

module.exports = router;
