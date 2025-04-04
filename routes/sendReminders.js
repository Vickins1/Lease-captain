const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');
const Tenant = require('../models/tenant'); 
const Reminder = require('../models/reminder'); 

// Middleware to parse JSON bodies
router.use(express.json());

// Function to send SMS via Umeskia Softwares API
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
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data.success === '200') {
            console.log(`SMS sent successfully to ${recipientPhone}:`, response.data);
            return true;
        } else {
            console.error(`Error sending SMS: ${response.data.massage}`);
            throw new Error('Failed to send SMS');
        }
    } catch (error) {
        console.error('Error sending SMS:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// Function to send email via Nodemailer
async function sendReminderEmail(recipientEmail, title, message) {
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
        console.log(`Email sent to ${recipientEmail}: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

// GET /api/tenants - Fetch all tenants
router.get('/api/tenants', async (req, res) => {
    try {
        const tenants = await Tenant.find({}, 'id name email phone'); // Include phone for SMS
        if (!tenants || tenants.length === 0) {
            return res.status(404).json({ error: 'No tenants found' });
        }

        const tenantData = tenants.map(tenant => ({
            id: tenant.id,
            name: tenant.name,
            email: tenant.email,
            phone: tenant.phone
        }));

        res.status(200).json(tenantData);
    } catch (error) {
        console.error('Error fetching tenants:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /manual-send-all - Send message to all tenants
router.post('/manual-send-all', async (req, res) => {
    try {
        const { messageType, message } = req.body;

        if (!messageType || !message) {
            return res.status(400).json({ error: 'Message type and content are required' });
        }

        if (!['sms', 'email'].includes(messageType)) {
            return res.status(400).json({ error: 'Invalid message type' });
        }

        const tenants = await Tenant.find({}, 'id name email phone');
        if (!tenants || tenants.length === 0) {
            return res.status(404).json({ error: 'No tenants found' });
        }

        const sendPromises = tenants.map(tenant => {
            if (messageType === 'sms' && tenant.phone) {
                return sendReminderSMS(tenant.phone, 'Broadcast Message', message);
            } else if (messageType === 'email' && tenant.email) {
                return sendReminderEmail(tenant.email, 'Broadcast Message', message);
            }
            return Promise.resolve(); // Skip if no contact info
        });

        await Promise.all(sendPromises);
        res.status(200).json({ message: `Messages sent successfully via ${messageType}` });
    } catch (error) {
        console.error('Error sending broadcast:', error);
        res.status(500).json({ error: 'Failed to send messages' });
    }
});

// POST /reminders/create - Create a new reminder
router.post('/reminders/create', async (req, res) => {
    try {
        const { title, message, sendAt, frequency } = req.body;

        if (!title || !message || !sendAt || !frequency) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const validFrequencies = ['once', 'daily', 'weekly', 'monthly'];
        if (!validFrequencies.includes(frequency)) {
            return res.status(400).json({ error: 'Invalid frequency' });
        }

        const reminder = new Reminder({
            title,
            message,
            sendAt: new Date(sendAt),
            frequency,
            status: 'pending',
            createdAt: new Date()
        });

        await reminder.save();
        res.status(201).json({ message: 'Reminder created successfully', reminder });
    } catch (error) {
        console.error('Error creating reminder:', error);
        res.status(500).json({ error: 'Failed to create reminder' });
    }
});

// POST /reminders/resend - Resend reminders to tenants
router.post('/reminders/resend', async (req, res) => {
    try {
        const { reminderOption, tenantId } = req.body;

        if (!reminderOption) {
            return res.status(400).json({ error: 'Reminder option is required' });
        }

        let tenants = [];
        if (reminderOption === 'single') {
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant ID is required for single tenant' });
            }
            const tenant = await Tenant.findById(tenantId, 'id name email phone');
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            tenants = [tenant];
        } else if (reminderOption === 'all') {
            tenants = await Tenant.find({}, 'id name email phone');
            if (!tenants || tenants.length === 0) {
                return res.status(404).json({ error: 'No tenants found' });
            }
        } else {
            return res.status(400).json({ error: 'Invalid reminder option' });
        }

        // Fetch pending reminders (you might want to filter by date or status)
        const reminders = await Reminder.find({ status: 'pending' });
        if (!reminders || reminders.length === 0) {
            return res.status(404).json({ error: 'No pending reminders found' });
        }

        const sendPromises = [];
        for (const tenant of tenants) {
            for (const reminder of reminders) {
                if (tenant.phone) {
                    sendPromises.push(
                        sendReminderSMS(tenant.phone, reminder.title, reminder.message)
                            .then(() => {
                                // Optionally update reminder status
                                reminder.status = 'sent';
                                return reminder.save();
                            })
                    );
                }
                if (tenant.email) {
                    sendPromises.push(
                        sendReminderEmail(tenant.email, reminder.title, reminder.message)
                            .then(() => {
                                reminder.status = 'sent';
                                return reminder.save();
                            })
                    );
                }
            }
        }

        await Promise.all(sendPromises);
        res.status(200).json({ message: 'Reminders resent successfully' });
    } catch (error) {
        console.error('Error resending reminders:', error);
        res.status(500).json({ error: 'Failed to resend reminders' });
    }
});

module.exports = router;