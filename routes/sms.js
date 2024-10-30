const axios = require('axios');

// UMS API credentials (replace with your actual credentials)
const UMS_API_KEY = 'VE5MTlkzRk06MTlwNjlkZWM=';  // Replace with your actual API key
const UMS_EMAIL = 'vickinstechnologies@gmail.com';  // Replace with your UMS email
const UMS_BASE_URL = 'https://api.umeskiasoftwares.com/api/v1';

/**
 * Send SMS using UMS API
 * @param {string} phoneNumber - Recipient's phone number
 * @param {string} message - The message you want to send
 * @param {string} senderId - Sender ID (UMS_SMS is the default)
 */
async function sendSMS(phoneNumber, message, senderId = 'UMS_SMS') {
    const apiUrl = `${UMS_BASE_URL}/sms`;

    const data = {
        api_key: UMS_API_KEY,
        email: UMS_EMAIL,
        Sender_Id: senderId,
        message: message,
        phone: phoneNumber
    };

    try {
        const response = await axios.post(apiUrl, data, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Log the response data
        console.log('SMS sent:', response.data);

        // Check if the message was sent successfully
        if (response.data.success === '200') {
            console.log('Message sent successfully');
        } else {
            console.error('Error sending message:', response.data.massage);
        }

    } catch (error) {
        console.error('Error sending SMS:', error.message);
    }
}

/**
 * Check SMS credit balance using UMS API
 */
async function checkSmsBalance() {
    const apiUrl = `${UMS_BASE_URL}/smsbalance`;

    const data = {
        api_key: UMS_API_KEY,
        email: UMS_EMAIL
    };

    try {
        const response = await axios.post(apiUrl, data, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('SMS Credit Balance:', response.data.creditBalance);
    } catch (error) {
        console.error('Error checking SMS balance:', error.message);
    }
}

/**
 * Get SMS delivery report using UMS API
 * @param {string} requestId 
 */
async function getSmsDeliveryReport(requestId) {
    const apiUrl = `${UMS_BASE_URL}/smsdelivery`;

    const data = {
        api_key: UMS_API_KEY,
        email: UMS_EMAIL,
        request_id: requestId
    };

    try {
        const response = await axios.post(apiUrl, data, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('SMS Delivery Report:', response.data);
    } catch (error) {
        console.error('Error getting SMS delivery report:', error.message);
    }
}

// Example usage:
(async () => {
    // Send an SMS
    await sendSMS('0798765432', 'Welcome to LeaseCaptain! Your account is ready.');

    // Check SMS balance
    await checkSmsBalance();

    // Get SMS delivery report (replace with your actual request ID)
    await getSmsDeliveryReport('8403414672158573510');
})();


module.exports = router;