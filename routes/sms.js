const nodemailer = require('nodemailer');
const cron = require('node-cron');
const axios = require('axios');
const Tenant = require('../models/tenant');
const Reminder = require('../models/reminder')

// UMS API Configuration
const UMS_API_KEY = 'VE5MTlkzRk06MTlwNjlkZWM=';
const UMS_EMAIL = 'vickinstechnologies@gmail.com';
const UMS_BASE_URL = 'https://api.umeskiasoftwares.com/api/v1';

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
       service: 'gmail',
       auth: {
              user: 'vickinstechnologies@gmail.com',
              pass: 'vnueayfgjstaazxh',
       },
});

// Function to send email reminders
async function sendEmailReminder(tenant) {
       const propertyName = tenant.propertyName || "Your Property";

       const mailOptions = {
              from: 'your-email@gmail.com',
              to: tenant.email,
              subject: 'Rent and Utility Payment Due Reminder',
              html: `
               <!DOCTYPE html>
               <html lang="en">
               <head>
                   <meta charset="UTF-8">
                   <meta name="viewport" content="width=device-width, initial-scale=1.0">
                   <style>
                       body {
                           font-family: Arial, sans-serif;
                           background-color: #ffffff;
                           margin: 0;
                           padding: 0;
                           color: #000000;
                       }
                       .container {
                           width: 100%;
                           max-width: 600px;
                           margin: 0 auto;
                           background-color: #ffffff;
                           padding: 20px;
                           border-radius: 8px;
                           box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                       }
                       .header {
                           background-color: #003366;
                           padding: 10px;
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
                       .cta-button {
                           display: inline-block;
                           padding: 12px 20px;
                           background-color: #003366;
                           color: white;
                           text-decoration: none;
                           border-radius: 5px;
                           margin-top: 10px;
                           text-align: center;
                       }
                       .cta-button:hover {
                           background-color: #00509E;
                       }
                   </style>
               </head>
               <body>
                   <div class="container">
                       <div class="header">
                           <h1>Payment Reminder</h1>
                       </div>
                       <div class="content">
                           <h2>Dear ${tenant.name},</h2>
                           <p>This is a friendly reminder regarding your upcoming payment for <strong>${propertyName}</strong>.</p>
                           <h3>Payment Details:</h3>
                           <p><strong>Rent Due:</strong> $${tenant.rentDue}</p>
                           ${tenant.utilityDue ? `<p><strong>Utility Fee Due:</strong> $${tenant.utilityDue}</p>` : ''}
                           <p><strong>Total Due:</strong> $${tenant.rentDue + (tenant.utilityDue || 0)}</p>
                           <p><strong>Due Date:</strong> ${tenant.rentDueDate}</p>
                          <p>To avoid any inconvenience, please make your payment directly through your Tenant Portal on or before the due date.</p>
                          <p>If you have any questions, feel free to contact us.</p>
                          <p><a href="https://leasecaptain.com/tenantPortal/login" class="cta-button"><strong>Access Your Tenant Portal</strong></a> to make a payment and manage your account.</p>

                       </div>
                       <div class="footer" style="text-align: center; margin-top: 20px;">
                           <p>&copy; 2024 Lease Captain. All Rights Reserved</p>
                       </div>
                   </div>
               </body>
               </html>
           `,
       };

       try {
              await transporter.sendMail(mailOptions);
              console.log(`Email reminder sent to ${tenant.email}`);
       } catch (error) {
              console.error('Error sending email:', error);
       }
}

// Function to send SMS reminders using UMS API
async function sendSMSReminder(tenant) {
       const smsMessage = `Dear ${tenant.name}, your rent of $${tenant.rentDue}${tenant.utilityDue ? ` + $${tenant.utilityDue} utility fee` : ''} for ${tenant.propertyName} is due on ${tenant.rentDueDate}. Please pay via the portal: leasecaptain.com/tenantPortal/login. Thank you!`;

       try {
              const response = await axios.post(
                     `${UMS_BASE_URL}/sms/send`,
                     {
                            phoneNumber: tenant.phone,
                            message: smsMessage,
                     },
                     {
                            headers: {
                                   'Authorization': `Bearer ${UMS_API_KEY}`,
                                   'Email': UMS_EMAIL,
                                   'Content-Type': 'application/json',
                            },
                     }
              );
              console.log(`SMS reminder sent to ${tenant.phone}:`, response.data);
       } catch (error) {
              console.error('Error sending SMS:', error);
       }
}

// Helper function to schedule reminders
async function scheduleReminders(ownerId) {
       const reminders = await Reminder.find({ status: 'scheduled', owner: ownerId });
       reminders.forEach((reminder) => {
              const sendDate = new Date(reminder.sendAt);

              // Define cron expression based on frequency
              let cronExpression;
              switch (reminder.frequency) {
                     case 'daily':
                            cronExpression = `${sendDate.getMinutes()} ${sendDate.getHours()} * * *`;
                            break;
                     case 'weekly':
                            cronExpression = `${sendDate.getMinutes()} ${sendDate.getHours()} * * ${sendDate.getDay()}`;
                            break;
                     case 'monthly':
                            cronExpression = `${sendDate.getMinutes()} ${sendDate.getHours()} ${sendDate.getDate()} * *`;
                            break;
                     default:
                            cronExpression = `${sendDate.getMinutes()} ${sendDate.getHours()} ${sendDate.getDate()} ${sendDate.getMonth() + 1} *`;
              }

              // Schedule the cron job
              cron.schedule(cronExpression, async () => {
                     try {
                            const tenants = await Tenant.find({ owner: ownerId });
                            tenants.forEach((tenant) => {
                                   sendEmailReminder(tenant);
                                   sendSMSReminder(tenant);
                            });

                            if (reminder.frequency === 'once') {
                                   reminder.status = 'completed';
                                   await reminder.save();
                            }
                     } catch (error) {
                            console.error('Error sending scheduled reminders:', error);
                     }
              });
       });
}

// Express route to start scheduling for logged-in owner
router.post('/schedule-reminders', async (req, res) => {
       const ownerId = req.user._id;
       scheduleReminders(ownerId);
       res.send('Reminders scheduled for your tenants.');
});

router.post('/manual-send-all', async (req, res) => {
       const { messageType, message } = req.body;
       const ownerId = req.user._id;

       try {
              const tenants = await Tenant.find({ owner: ownerId });
              if (tenants.length === 0) return res.status(404).json({ error: 'No tenants found for this owner' });


              for (const tenant of tenants) {
                     if (messageType === 'email') {
                            await sendManualEmail(tenant, message);
                     } else if (messageType === 'sms') {
                            await sendManualSMS(tenant, message);
                     }
              }

              res.status(200).json({ message: 'Message sent to all tenants successfully' });
       } catch (error) {
              console.error('Error sending manual message to all tenants:', error);
              res.status(500).json({ error: 'Failed to send message' });
       }
});

// Endpoint to fetch templates
router.get('/api/templates', async (req, res) => {
       try {
              const templates = await Template.find();
              res.json(templates);
       } catch (error) {
              console.error('Error fetching templates:', error);
              res.status(500).json({ error: 'Failed to fetch templates' });
       }
});

// Function to send manual email to a tenant
async function sendManualEmail(tenant, customMessage) {
       const mailOptions = {
              from: 'your-email@gmail.com',
              to: tenant.email,
              subject: 'Message from Management',
              html: `<p>${customMessage}</p>`
       };

       try {
              await transporter.sendMail(mailOptions);
              console.log(`Manual email sent to ${tenant.email}`);
       } catch (error) {
              console.error('Error sending manual email:', error);
       }
}

// Function to send manual SMS to a tenant
async function sendManualSMS(tenant, customMessage) {
       try {
              await axios.post(
                     `${UMS_BASE_URL}/sms/send`,
                     {
                            phoneNumber: tenant.phone,
                            message: customMessage
                     },
                     {
                            headers: {
                                   'Authorization': `Bearer ${UMS_API_KEY}`,
                                   'Email': UMS_EMAIL,
                                   'Content-Type': 'application/json'
                            }
                     }
              );
              console.log(`Manual SMS sent to ${tenant.phone}`);
       } catch (error) {
              console.error('Error sending manual SMS:', error);
       }
}

