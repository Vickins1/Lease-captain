const axios = require('axios');

async function checkSMSCreditBalance() {
    try {
        const smsApiUrl = 'https://api.umeskiasoftwares.com/api/v1/smsbalance';
        const response = await axios.post(smsApiUrl, {
            api_key: process.env.UMS_API_KEY,
            email: process.env.UMS_EMAIL,
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success === '200') {
            return response.data.creditBalance;
        } else {
            throw new Error('Failed to fetch SMS credit balance');
        }
    } catch (error) {
        console.error('Error fetching SMS credit balance:', error.message);
        throw error;
    }
}

module.exports = { checkSMSCreditBalance };
