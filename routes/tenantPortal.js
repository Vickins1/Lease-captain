const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant');
const bcrypt = require('bcryptjs');
const MaintenanceRequest = require('../models/maintenanceRequest')
const Payment = require('../models/payment')

router.get('/tenantPortal/login', (req, res) => {
    res.render('tenantPortal/login');
});

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

        // Store tenant information in session
        req.session.tenantId = tenant._id;
        req.session.tenant = {
            name: tenant.name,
            email: tenant.email,
            property: tenant.property,
            unit: tenant.unit 
        };

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
        if (!tenantId) {
            req.flash('error', 'Please log in to access the dashboard');
            return res.redirect('/tenantPortal/login');
        }

        const tenant = await Tenant.findById(tenantId)
            .populate('property', 'name paymentDay')
            .populate('unit', 'unitType unitPrice utilities')
            .lean();

        if (!tenant) {
            req.flash('error', 'Tenant not found');
            return res.redirect('/tenantPortal/login');
        }

        const property = tenant.property || {};
        const unit = tenant.unit || {};

        const [rentPayments, utilityPayments, maintenanceRequests] = await Promise.all([
            Payment.find({ tenant: tenantId, paymentType: 'rent' }).lean(),
            Payment.find({ tenant: tenantId, paymentType: 'utility' }).lean(),
            MaintenanceRequest.find({ tenantId }).lean()
        ]);

        // Ensure all numeric inputs are valid numbers
        const totalRentPaid = (Number(tenant.rentPaid) || 0) + 
            (rentPayments || []).reduce((acc, p) => acc + (Number(p.rentPaid) || 0), 0);
        const totalUtilityPaid = (Number(tenant.utilityPaid) || 0) + 
            (utilityPayments || []).reduce((acc, p) => acc + (Number(p.utilityPaid) || 0), 0);

        const unitUtilities = Array.isArray(unit.utilities) ? unit.utilities : [];
        const totalUtilityCharges = unitUtilities.reduce((acc, utility) => 
            acc + (Number(utility.amount) || 0), 0);
        const utilityDue = Math.max(totalUtilityCharges - totalUtilityPaid, 0);

        const today = new Date();
        const leaseStartDate = tenant.leaseStartDate ? new Date(tenant.leaseStartDate) : today;
        const monthsElapsed = Math.max(1, Math.floor(
            (today - leaseStartDate) / (1000 * 60 * 60 * 24 * 30)
        ));
        const unitPrice = Number(unit.unitPrice) || 0;
        const totalRentExpected = monthsElapsed * unitPrice;
        const rentDue = Math.max(totalRentExpected - totalRentPaid, 0);

        const depositAmount = Number(tenant.deposit) || 0; // Total deposit required
const walletBalance = Number(tenant.walletBalance) || 0; // Current wallet balance

// Calculate depositPaid
const depositPaid = walletBalance > 0 
    ? depositAmount // If walletBalance is positive, deposit is fully paid
    : walletBalance < 0 
        ? Math.max(0, depositAmount + walletBalance) // Handle negative wallet balance
        : Math.min(depositAmount, walletBalance); // Handle zero wallet balance

// Calculate remaining wallet balance (overpayment)
const remainingWalletBalance = walletBalance > depositAmount 
    ? walletBalance - depositAmount 
    : 0;

        const paymentDay = property.paymentDay || 1;
        let nextRentDue = new Date(today.getFullYear(), today.getMonth(), paymentDay);
        if (nextRentDue <= today) nextRentDue.setMonth(nextRentDue.getMonth() + 1);
        const formattedNextRentDue = moment(nextRentDue).format('MMMM D, YYYY');

        const formattedRequests = (maintenanceRequests || []).map(req => ({
            scheduleDateFormatted: req.scheduleDate 
                ? moment(req.scheduleDate).format('MM/DD/YYYY') 
                : 'Not Scheduled',
            status: req.status || 'pending'
        }));

        const recentTransactions = [...rentPayments, ...utilityPayments]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5)
            .map(p => ({
                date: p.date || new Date(),
                type: p.paymentType,
                amount: Number(p.rentPaid || p.utilityPaid || 0),
                status: p.status || 'completed'
            }));

        const leaseEndDate = tenant.leaseEndDate ? new Date(tenant.leaseEndDate) : today;
        const totalLeaseDays = Math.max(1, (leaseEndDate - leaseStartDate) / (1000 * 60 * 60 * 24));
        const daysPassed = Math.max(0, (today - leaseStartDate) / (1000 * 60 * 60 * 24));
        const leaseProgress = Math.min(100, Math.round((daysPassed / totalLeaseDays) * 100));

        // Chart data
        const rentGraphData = {
            labels: ['Paid', 'Due'],
            datasets: [{
                data: [totalRentPaid, rentDue],
                backgroundColor: ['#28a745', '#dc3545'],
                borderColor: ['#28a745', '#dc3545'],
                borderWidth: 1
            }]
        };
        const utilityGraphData = {
            labels: ['Paid', 'Due'],
            datasets: [{
                data: [totalUtilityPaid, utilityDue],
                backgroundColor: ['#007bff', '#ff9800'],
                borderColor: ['#007bff', '#ff9800'],
                borderWidth: 1
            }]
        };
        const announcements = [
            { 
                type: 'info', 
                message: rentDue > 0 
                    ? `Rent due in ${Math.ceil((nextRentDue - today) / (1000 * 60 * 60 * 24))} days!`
                    : 'All payments up to date!'
            }
        ];

        res.render('tenantPortal/dashboard', {
            tenant,
            rentGraphData: JSON.stringify(rentGraphData),
            utilityGraphData: JSON.stringify(utilityGraphData),
            walletBalance: walletBalance.toFixed(2),
            nextRentDue: formattedNextRentDue,
            totalRentPaid: totalRentPaid.toFixed(2), // Already a string
            utilityPaid: totalUtilityPaid.toFixed(2), // Already a string
            rentDue: rentDue.toFixed(2), // Already a string
            utilityDue: utilityDue.toFixed(2), // Already a string
            depositAmount: depositAmount.toFixed(2), // Already a string
            depositPaid: depositPaid.toFixed(2), // Already a string
            announcements,
            recentTransactions,
            leaseProgress,
            maintenanceScheduleDates: formattedRequests
        });

    } catch (error) {
        console.error('Dashboard Error:', {
            message: error.message,
            stack: error.stack,
            tenantId: req.session.tenantId,
            timestamp: new Date().toISOString()
        });
        req.flash('error', 'An error occurred while loading your dashboard');
        return res.redirect('/tenantPortal/login');
    }
});

router.get('/payments', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;

        // Check if tenantId is defined
        if (!tenantId) {
            console.log('Tenant ID is undefined');
            req.flash('error', 'Please log in first.');
            return res.redirect('/tenantPortal/login');
        }

        const tenant = await Tenant.findById(tenantId).exec();

        if (!tenant) {
            req.flash('error', 'Tenant not found.');
            return res.redirect('/tenantPortal/login');
        }

        // Fetch payments associated with the tenant
        const payments = await Payment.find({ tenant: tenantId }).exec();

        // Check if there are payments and handle accordingly
        if (payments.length === 0) {
            console.log('No payments found for this tenant.');
            req.flash('info', 'No payments found for your account.');
        }

        res.render('tenantPortal/payments', {
            tenant,
            payments,
            title: 'Your Payments',
            success: req.flash('success'),
            error: req.flash('error'),
            info: req.flash('info')
        });
    } catch (error) {
        console.error('Error fetching payment data:', error);
        req.flash('error', 'Error fetching payment data.');
        res.redirect('/tenantPortal/dashboard');
    }
});

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


router.get('/tenantPortal/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error logging out');
        }

        res.redirect('/tenantPortal/login');
    });
});

function calculateWalletBalance(leaseStartDate, currentRentPaid, monthlyRent, depositAmount, currentDate) {
    let leaseStart = new Date(leaseStartDate);
    let current = new Date(currentDate);

    let monthsSinceStart = (current.getFullYear() - leaseStart.getFullYear()) * 12 + (current.getMonth() - leaseStart.getMonth());
    monthsSinceStart = Math.max(monthsSinceStart, 1);

    let totalRentDue = monthsSinceStart * monthlyRent;
    let overpayment = Math.max(currentRentPaid - totalRentDue, 0);

    let walletBalance = -depositAmount;
    walletBalance += overpayment;

    return walletBalance;
}


router.get('/tenant/profile', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            return res.redirect('/tenantPortal/login');
        }

        const tenant = await Tenant.findById(tenantId).populate('unit');
        if (!tenant) {
            return res.status(404).send('Tenant not found');
        }

        const rentPayments = await Payment.find({
            tenant: tenantId,
            paymentType: 'rent',
        });

        const totalRentPaid = tenant.rentPaid || 0;
        const monthlyRent = tenant.unit?.unitPrice || 0;
        const depositAmount = tenant.deposit || 0;
        const leaseStartDate = tenant.leaseStartDate || new Date();
        const currentDate = new Date();
        const overpayment = tenant.overpayment || 0;

        // Calculate wallet balance, factoring in overpayment and rent paid
        let walletBalance = calculateWalletBalance(leaseStartDate, totalRentPaid + overpayment, monthlyRent, depositAmount, currentDate);

        // Calculate deposit paid using wallet balance and deposit amount
        let depositPaid = depositAmount + walletBalance;

        depositPaid = Math.min(depositPaid, depositAmount);

        // Update wallet balance in tenant record
        tenant.walletBalance = walletBalance;
        await tenant.save();

        res.render('tenantPortal/profile', {
            tenant,
            totalRentPaid,
            walletBalance,
            monthlyRent,
            depositAmount,
            depositPaid,
        });
    } catch (error) {
        console.error('Error fetching tenant profile:', error);
        res.status(500).send('Error fetching tenant profile');
    }
});


// Route to render the agreement page
router.get('/tenant/agreement', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            req.flash('error', 'Please log in to view the agreement.');
            return res.redirect('/tenantPortal/login');
        }

        // Fetch tenant details from the database
        const tenant = await Tenant.findById(tenantId).populate('unit').populate('property');
        if (!tenant) {
            req.flash('error', 'Tenant not found.');
            return res.redirect('/tenantPortal/dashboard');
        }

        // Render the agreement page, passing tenant information to the view
        res.render('tenantPortal/agreement', {
            tenant,
        });
    } catch (error) {
        console.error('Error fetching tenant data for agreement page:', error);
        req.flash('error', 'An error occurred while fetching tenant data.');
        return res.redirect('/tenantPortal/dashboard');
    }
});


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

const moment = require('moment');

router.get('/requestMaintenance', async (req, res) => {
    try {
        const tenantId = req.session.tenantId;
        if (!tenantId) {
            return res.redirect('tenantPortal/login');
        }

        const maintenanceRequests = await MaintenanceRequest.find({ tenantId });
        const tenant = await Tenant.findById(tenantId);

        const formattedRequests = maintenanceRequests.map(request => ({
            ...request._doc,
            scheduleDateFormatted: request.scheduleDate
                ? moment(request.scheduleDate).format('MM/DD/YYYY')
                : 'No Date'
        }));

        const success_msg = req.flash('success_msg');
        const error_msg = req.flash('error_msg');

        res.render('tenantPortal/maintenance', {
            maintenanceRequests: formattedRequests,
            tenant,
            error_msg,
            success_msg
        });
    } catch (err) {
        console.error('Error fetching maintenance requests:', err);
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


module.exports = router;
