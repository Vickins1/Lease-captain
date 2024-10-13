const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant');
const bcrypt = require('bcrypt');
const MaintenanceRequest = require('../models/maintenanceRequest')

// Tenant login route 
router.get('/tenantPortal/login', (req, res) => {
    res.render('tenantPortal/login');
});

// Tenant login route 
router.post('/tenant/login', async (req, res) => {
    const { name, password } = req.body; 

    if (!name || !password) {
        req.flash('error', 'Name and password are required.');
        return res.redirect('/tenantPortal/login');
    }

    try {
        const tenant = await Tenant.findOne({ name });

        if (!tenant) {
            req.flash('error', 'Invalid name or password.');
            return res.redirect('/tenantPortal/login');
        }

        // Compare the provided password with the hashed password stored in the database
        const isMatch = await bcrypt.compare(password, tenant.password);

        if (!isMatch) {
            console.error('Password comparison failed for tenant:', {
                enteredPassword: password,
                storedHashedPassword: tenant.password
            });
            req.flash('error', 'Invalid name or password.');
            return res.redirect('/tenantPortal/login');
        }

        req.session.tenantId = tenant._id;
        req.session.name = tenant.name;

        req.flash('success', `Login successful. Welcome, ${tenant.name}! Manage your payments efficiently and easily.`);
        return res.redirect('/tenantPortal/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        req.flash('error', 'Something went wrong. Please try again.');
        return res.redirect('/tenantPortal/login');
    }
});



router.get('/tenantPortal/dashboard', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;

        const tenant = await Tenant.findById(tenantId)
            .populate({
                path: 'property',
                select: 'name paymentDay', 
            })
            .populate({
                path: 'unit',
                select: 'unitName unitPrice utilities', 
            })
            .populate({
                path: 'maintenanceRequests',
                select: 'scheduleDate description status',
            })
            .exec();

        console.log('Tenant Data:', tenant);
        if (!tenant) {
            req.flash('error', 'Tenant not found');
            return res.redirect('/tenantPortal/login');
        }

        // Fetch maintenance requests
        const maintenanceRequests = await MaintenanceRequest.find({ tenantId });
        const maintenanceScheduleDates = maintenanceRequests.map(request => ({
            date: request.scheduleDate,
            description: request.description,
            status: request.status,
        }));

        // Calculate total rent paid and rent due
        const totalRentPaid = tenant.paymentHistory.reduce((acc, payment) => acc + (payment.amount || 0), 0);
        const unitPrice = tenant.unit?.unitPrice || 0;
        const rentDue = Math.max(0, unitPrice - totalRentPaid); 

        // Calculate utility due based on utilities from the unit
        const unitUtilities = tenant.unit?.utilities || [];
        const utilityDue = unitUtilities.reduce((acc, utility) => acc + (utility.amount || 0), 0); 
        // Get payment details
        const paymentDay = tenant.property?.paymentDay || 1;
        const today = new Date();
        let nextRentDue = new Date(today.getFullYear(), today.getMonth(), paymentDay);

        if (nextRentDue <= today) {
            nextRentDue.setMonth(nextRentDue.getMonth() + 1); 
        }

        const rentDueInDays = Math.ceil((nextRentDue - today) / (1000 * 60 * 60 * 24)); 
        const formattedNextRentDue = nextRentDue.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        const announcements = [{ type: 'info', message: 'This is your daily announcement!' }];

        // Render the dashboard with all necessary data
        res.render('tenantPortal/dashboard', {
            tenant,
            nextRentDue: formattedNextRentDue,
            totalRentPaid,
            utilityPaid: tenant.utilityPaid || 0,
            rentDue,
            utilityDue,
            announcements,
            rentDueInDays,
            leaseEndDate: tenant.leaseEndDate,
            maintenanceScheduleDates,
            unitName: tenant.unit?.unitName || 'N/A',
            roomNumber: tenant.doorNumber || 'N/A',
            monthlyRent: unitPrice ? unitPrice.toFixed(2) : 'N/A',
        });
    } catch (error) {
        console.error('Error fetching tenant data:', error.message);
        req.flash('error', 'Error fetching tenant data');
        return res.redirect('/tenantPortal/login');
    }
});



// Payments route to display tenant's payment history
router.get('/payments', async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.session.tenantId).populate('property').exec();

        if (!tenant) {
            req.flash('error', 'Tenant not found.');
            return res.redirect('/tenantPortal/login');
        }

        const paymentHistory = tenant.paymentHistory || [];
        const totalRentPaid = paymentHistory.reduce((acc, payment) => acc + (payment.amount || 0), 0);
        const outstandingBalance = tenant.outstandingBalance || 0;

        res.render('tenantPortal/payments', {
            tenant,
            paymentHistory,
            totalRentPaid,
            outstandingBalance
        });
    } catch (error) {
        console.error('Error fetching payment data:', error);
        req.flash('error', 'Error fetching payment data.');
        res.redirect('/tenantPortal/dashboard');
    }
});





// Lease route to display tenant's lease information
router.get('/lease', async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.session.tenantId).populate('property').exec();

        if (!tenant) {
            req.flash('error', 'Tenant not found.');
            return res.redirect('/tenantPortal/login');
        }

        const leaseStatus = tenant.status;

        res.render('tenantPortal/lease', {
            tenant,
            leaseStatus
        });
    } catch (error) {
        console.error('Error fetching lease information:', error);
        req.flash('error', 'Error fetching lease information.');
        res.redirect('/tenantPortal/dashboard');
    }
});




// Logout route
router.get('/tenantPortal/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error logging out');
        }

        res.redirect('/tenantPortal/login');
    });
});

// Serve Profile Settings Page
router.get('/tenant/profile', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            return res.redirect('/tenantPortal/login');
        }

        const tenant = await Tenant.findById(tenantId)
            .populate('utilityPayments') 
            .exec();

        if (!tenant) {
            return res.status(404).send('Tenant not found');
        }

        // Calculate total utility paid
        const totalUtilityPaid = tenant.utilityPayments.reduce((acc, utility) => acc + (utility.amount || 0), 0);
        
        // Calculate total rent paid
        const totalRentPaid = tenant.paymentHistory.reduce((acc, payment) => acc + (payment.amount || 0), 0);
        const unitPrice = tenant.unit?.unitPrice || 0;
        const rentDue = Math.max(0, unitPrice - totalRentPaid);
        
        const depositAmount = tenant.deposit || 0;
        const walletBalance = totalUtilityPaid - depositAmount;

        res.render('tenantPortal/profile', { 
            tenant,
            totalUtilityPaid,
            walletBalance,
            rentDue
        });
    } catch (error) {
        console.error('Error fetching tenant profile:', error);
        res.status(500).send('Error fetching tenant profile');
    }
});



// Handle Refund Request
router.post('/tenant/requestRefund', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        const { amount } = req.body;

        if (!tenantId) {
            return res.status(401).send('Unauthorized');
        }

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return res.status(404).send('Tenant not found');
        }

        if (amount <= 0 || amount > tenant.walletBalance) {
            return res.status(400).send('Invalid refund amount');
        }

        tenant.walletBalance -= amount;
        await tenant.save();

        req.flash('success', 'Refund request successful. Your refund is being processed.');
        res.redirect('/tenant/profile');
    } catch (error) {
        console.error('Error processing refund:', error);
        req.flash('error', 'An error occurred while processing your refund request.');
        res.redirect('/tenant/profile');
    }
});



// Change Password Route
router.post('/tenant/profile/change-password', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            return res.redirect('/tenantPortal/login');
        }

        const tenant = await Tenant.findById(tenantId);

        if (!tenant) {
            return res.status(404).send('Tenant not found');
        }

        const { currentPassword, newPassword, confirmPassword } = req.body;

        const isMatch = await bcrypt.compare(currentPassword, tenant.password);
        if (!isMatch) {
            req.flash('error', 'Current password is incorrect.');
            return res.redirect('/tenant/profile');
        }

        if (newPassword !== confirmPassword) {
            req.flash('error', 'New passwords do not match.');
            return res.redirect('/tenant/profile');
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        tenant.password = hashedPassword;
        await tenant.save();

        req.flash('success', 'Password changed successfully!');
        res.redirect('/tenant/profile');
    } catch (error) {
        console.error('Error changing password:', error);
        req.flash('error', 'An error occurred while changing the password.');
        res.redirect('/tenant/profile');
    }
});


// Update tenant profile
router.post('/tenant/profile/update', async (req, res) => {
    const { name, email } = req.body;

    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            req.flash('error', 'User is not authenticated');
            return res.redirect('/tenantPortal/login');
        }

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            req.flash('error', 'Tenant not found');
            return res.redirect('/tenant/profile');
        }

        if (name) tenant.name = name;
        if (email) tenant.email = email;

        await tenant.save();

        req.session.tenant = tenant;

        req.flash('success', 'Profile updated successfully.');
        res.redirect('/tenant/profile');
    } catch (error) {
        console.error('Error updating profile:', error);
        req.flash('error', 'Error updating profile');
        res.redirect('/tenant/profile');
    }
});


// Serve Payments Page
router.get('/tenant/payments', async (req, res) => {
    try {

        const tenant = await Tenant.findById(tenantId);

        if (!tenant) {
            return res.status(404).send('Tenant not found');
        }

        res.render('tenantPortal/payments', { tenant });
    } catch (error) {
        console.error('Error fetching tenant profile:', error);
        res.status(500).send('Error fetching tenant profile');
    }
});

// GET: Fetch maintenance requests and tenant information
router.get('/requestMaintenance', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            return res.redirect('tenantPortal/login');
        }

        const maintenanceRequests = await MaintenanceRequest.find({ tenantId });
        const tenant = await Tenant.findById(tenantId);


        const success_msg = req.flash('success_msg');
        const error_msg = req.flash('error_msg');

        res.render('tenantPortal/maintenance', {
            maintenanceRequests,
            tenant,
            error_msg,
            success_msg
        });
    } catch (err) {
        console.error(err);
        res.render('tenantPortal/maintenance', {
            maintenanceRequests: [],
            tenant: null,
            error_msg: 'Failed to retrieve maintenance requests.',
            success_msg: null
        });
    }
});


// POST - Add a new maintenance request
router.post('/maintenance/new', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;

        const { description } = req.body;
        const newRequest = new MaintenanceRequest({
            tenantId,
            description,
            status: 'pending'
        });

        await newRequest.save();

        req.flash('success_msg', 'Maintenance request submitted successfully.');
        return res.redirect('/requestMaintenance');
    } catch (error) {
        console.error('Error submitting maintenance request:', error);
        req.flash('error_msg', 'Error submitting maintenance request.');
        return res.redirect('/requestMaintenance');
    }
});

// Edit a maintenance request
router.post('/maintenance/edit', async (req, res) => {
    const { requestId, description } = req.body;

    if (!requestId || !description) {
        req.flash('error_msg', 'All fields are required.');
        return res.redirect('/requestMaintenance');
    }

    try {
        const updatedRequest = await MaintenanceRequest.findByIdAndUpdate(requestId, { description });

        if (!updatedRequest) {
            req.flash('error_msg', 'Maintenance request not found.');
            return res.redirect('/requestMaintenance');
        }

        req.flash('success_msg', 'Maintenance request updated successfully.');
        return res.redirect('/requestMaintenance');
    } catch (error) {
        console.error('Error updating maintenance request:', error);
        req.flash('error_msg', 'Failed to update request.');
        return res.redirect('/requestMaintenance');
    }
});


// POST - Delete a maintenance request
router.post('/requests/:id/delete', async (req, res) => {
    try {
        const requestId = req.params.id;

        if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
            req.flash('error_msg', 'Invalid request ID');
            return res.redirect('/requestMaintenance');
        }

        const request = await MaintenanceRequest.findByIdAndDelete(requestId);

        if (!request) {
            req.flash('error_msg', 'Maintenance request not found');
            return res.redirect('/requestMaintenance');
        }

        req.flash('success_msg', 'Request deleted successfully.');
        res.redirect('/requestMaintenance');
    } catch (err) {
        console.error('Error deleting request:', err);
        req.flash('error_msg', 'An error occurred while trying to delete the request.');
        res.redirect('/requestMaintenance');
    }
});

async function handlePayment(tenantId, amount) {
    const tenant = await Tenant.findById(tenantId);

    if (!tenant) {
        throw new Error('Tenant not found');
    }

    const expectedAmount = tenant.unit?.unitPrice || 0; 

    if (amount > expectedAmount) {
        const overpaymentAmount = amount - expectedAmount;

        // Update tenant wallet balance and overpayment amount
        tenant.walletBalance += overpaymentAmount;
        tenant.overpayment = (tenant.overpayment || 0) + overpaymentAmount; // Initialize if undefined
    } else {
        tenant.rentPaid += amount;
    }

    await tenant.save();
}

async function getNextPaymentDetails(tenantId) {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
        throw new Error('Tenant not found');
    }

    const paymentDay = tenant.property?.paymentDay || 1;
    const today = new Date();
    let nextRentDue = new Date(today.getFullYear(), today.getMonth(), paymentDay);

    if (nextRentDue <= today) {
        nextRentDue.setMonth(nextRentDue.getMonth() + 1);
    }

    // Deduct from wallet if available
    if (tenant.walletBalance > 0) {
        const amountToDeduct = Math.min(tenant.walletBalance, tenant.unit?.unitPrice || 0);
        tenant.walletBalance -= amountToDeduct;
        await tenant.save();
        nextRentDue.setDate(nextRentDue.getDate() + 30); 
    }

    return {
        nextRentDue,
        rentDueInDays: Math.ceil((nextRentDue - today) / (1000 * 60 * 60 * 24)),
    };
}


async function withdrawFromWallet(tenantId, amount) {
    const tenant = await Tenant.findById(tenantId);

    if (!tenant) {
        throw new Error('Tenant not found');
    }

    if (amount > tenant.walletBalance) {
        throw new Error('Insufficient wallet balance.');
    }

    tenant.walletBalance -= amount; 
    await tenant.save();
}




module.exports = router;
