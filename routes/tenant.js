const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant');
const Property = require('../models/property');
const Payment = require('../models/payment');
const {  checkRole,isTenancyManager } = require('../middleware');
const PropertyUnit = require('../models/unit');
const moment = require('moment') 
const mongoose = require('mongoose');

//Route to get all tenants for the logged-in user
// This route is protected and requires the user to be a tenancy manager
router.get('/tenancy-manager/tenants', isTenancyManager, async (req, res) => {
    try {
        const currentUser = req.user;

        if (!currentUser) {
            req.flash('error', 'You must be logged in to view this page.');
            return res.redirect('/login');
        }

        const perPage = 10;
        const page = parseInt(req.query.page) || 1;
        const searchTerm = req.query.search || '';
        const regex = new RegExp(searchTerm, 'i');

        // Query for tenants with sorting by createdAt (descending)
        const tenantQuery = {
            owner: currentUser._id,
            $or: [
                { name: regex },
                { email: regex },
                { 'property.name': regex }
            ]
        };

        const tenants = await Tenant.find(tenantQuery)
            .populate('property', 'name')
            .populate('unit', 'unitType')
            .sort({ createdAt: -1 }) // Sort by creation date, newest first
            .skip((perPage * page) - perPage)
            .limit(perPage)
            .lean(); // Use lean() for performance since we modify in-memory

        // Calculate lease status for each tenant (in-memory)
        tenants.forEach(tenant => {
            const currentDate = moment();
            const leaseEndDate = moment(tenant.leaseEndDate);
            tenant.leaseStatus = leaseEndDate.isBefore(currentDate) ? 'Expired' : 'Active';
        });

        // Count total tenants matching the search criteria
        const totalTenants = await Tenant.countDocuments(tenantQuery);

        // Handle AJAX request for partial rendering
        if (req.query.ajax) {
            return res.render('tenancyManager/_tenantList', { 
                tenants, 
                currentPage: page, 
                perPage 
            });
        }

        // Fetch properties for the edit modal
        const properties = await Property.find({ owner: currentUser._id });
        const messages = { success: req.flash('success'), error: req.flash('error') };

        res.render('tenancyManager/tenants', {
            tenants,
            properties,
            messages,
            currentPage: page,
            perPage,
            totalPages: Math.ceil(totalTenants / perPage),
            currentUser,
            searchTerm,
            totalTenants // Added for pagination display
        });
    } catch (err) {
        console.error('Error fetching tenants:', err);
        req.flash('error', 'Error fetching tenants.');
        res.redirect('/tenancy-manager/properties');
    }
});


// GET units for a specific property, along with the utility amount
router.get('/api/property/:propertyId/units', async (req, res) => {
    const { propertyId } = req.params;

    try {
        const property = await Property.findById(propertyId).select('utilityAmount');

        
        if (!property) {
            return res.status(404).json({ error: 'Property not found' });
        }

        
        const units = await PropertyUnit.find({ propertyId }).select('unitName deposit utilities');

        
        const response = {
            utilityAmount: property.utilityAmount || 0, 
            units: units.map(unit => ({
                _id: unit._id,
                unitName: unit.unitName,
                deposit: unit.deposit,
                
                utilities: unit.utilities.map(utility => ({
                    type: utility.type,
                    amount: utility.amount
                })),
            })),
        };

        res.json(response);
    } catch (err) {
        console.error('Error fetching units:', err);
        res.status(500).send('Server Error');
    }
});


// POST route to update tenant details
router.post('/tenancy-manager/tenants/edit/:id', isTenancyManager, async (req, res) => {
    const { name, email, phone, leaseStartDate, leaseEndDate, propertyId, rentPaid, utilityPaid, walletBalance, outstandingPayments } = req.body;

    try {
        await Tenant.findByIdAndUpdate(req.params.id, {
            name,
            email,
            phone,
            leaseStartDate,
            leaseEndDate,
            property: propertyId,
            rentPaid: rentPaid || 0,
            utilityPaid: utilityPaid || 0,
            walletBalance: walletBalance || 0,
            outstandingPayments: outstandingPayments || 0,
        });

        req.flash('success', 'Tenant updated successfully.');
        res.redirect('/tenancy-manager/tenants');
    } catch (err) {
        req.flash('error', 'Error updating tenant.');
        res.redirect('/tenancy-manager/tenants');
    }
});

// Tenant Report Route for Owner
router.get('/tenancy-manager/tenant-report/:tenantId', async (req, res) => {
    try {
        // Authentication Check
        if (!req.user) {
            req.flash('error', 'Please log in to access tenant reports');
            return res.redirect('/login');
        }

        const tenantId = req.params.tenantId;

        // Fetch Tenant Data
        const tenant = await mongoose.model('Tenant').findOne({ _id: tenantId, owner: req.user._id })
            .populate('property', 'name address paymentDay')
            .populate('unit', 'unitType unitPrice utilities')
            .lean();

        if (!tenant) {
            req.flash('error', 'Tenant not found or you do not have access');
            return res.redirect('/tenancy-manager/dashboard');
        }

        // Fetch Payment History
        const payments = await mongoose.model('Payment').find({ tenant: tenantId })
            .sort({ datePaid: -1 })
            .lean();

        // Fetch Properties for Edit Modal
        const properties = await mongoose.model('Property').find({ owner: req.user._id }).lean();

        // Calculate Metrics
        const toNumber = (value) => Number(value) || 0;

        // Helper: Get months with proration
        function getMonthsBetween(startDate, endDate, currentDate) {
            const months = [];
            let current = new Date(startDate);
            current.setDate(1);
            const effectiveEnd = endDate && endDate < currentDate ? endDate : currentDate;
            while (current <= effectiveEnd) {
                const yearMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
                const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
                const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
                const daysInMonth = monthEnd.getDate();
                const effectiveStart = startDate > monthStart ? startDate : monthStart;
                const effectiveMonthEnd = effectiveEnd < monthEnd ? effectiveEnd : monthEnd;
                const daysActive = Math.ceil((effectiveMonthEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
                const prorationFactor = daysActive / daysInMonth;
                months.push({ yearMonth, prorationFactor });
                current.setMonth(current.getMonth() + 1);
            }
            return months;
        }

        const leaseStartDate = tenant.leaseStartDate ? new Date(tenant.leaseStartDate) : new Date();
        const leaseEndDate = tenant.leaseEndDate ? new Date(tenant.leaseEndDate) : null;
        const currentDate = new Date('2025-05-09');
        const monthlyRent = toNumber(tenant.unit?.unitPrice);
        const utilities = Array.isArray(tenant.unit?.utilities) ? tenant.unit.utilities : [];
        const totalUtilityPerMonth = utilities.reduce((sum, util) => sum + toNumber(util.amount), 0);

        const months = getMonthsBetween(leaseStartDate, leaseEndDate, currentDate);

        let expectedRent = 0;
        let expectedUtility = 0;
        const monthlyData = {};

        for (const { yearMonth, prorationFactor } of months) {
            const monthlyExpectedRent = monthlyRent * prorationFactor;
            const monthlyExpectedUtility = totalUtilityPerMonth * prorationFactor;
            expectedRent += monthlyExpectedRent;
            expectedUtility += monthlyExpectedUtility;
            monthlyData[yearMonth] = {
                expectedRent: monthlyExpectedRent,
                expectedUtility: monthlyExpectedUtility,
                rentPaid: 0,
                utilityPaid: 0
            };
        }

        let totalRentPaid = 0;
        let totalUtilityPaid = 0;

        for (const payment of payments.filter(p => p.status === 'completed')) {
            const paymentDate = new Date(payment.datePaid || currentDate);
            const yearMonth = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
            if (payment.paymentType === 'rent') {
                const amount = toNumber(payment.rentPaid);
                totalRentPaid += amount;
                if (monthlyData[yearMonth]) {
                    monthlyData[yearMonth].rentPaid += amount;
                }
            } else if (payment.paymentType === 'utility') {
                const amount = toNumber(payment.utilityPaid);
                totalUtilityPaid += amount;
                if (monthlyData[yearMonth]) {
                    monthlyData[yearMonth].utilityPaid += amount;
                }
            }
        }

        const rentDue = Math.max(0, expectedRent - totalRentPaid);
        const utilityDue = Math.max(0, expectedUtility - totalUtilityPaid);
        const totalPaid = totalRentPaid + totalUtilityPaid;
        const totalDue = rentDue + utilityDue;
        const overpayment = Math.max(0, totalRentPaid - expectedRent);

        // Lease Duration
        const leaseStart = new Date(tenant.leaseStartDate);
        const leaseEnd = new Date(tenant.leaseEndDate);
        const leaseDurationDays = Math.max(1, (leaseEnd - leaseStart) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, (leaseEnd - currentDate) / (1000 * 60 * 60 * 24));
        const leaseProgress = Math.min(100, Math.round((leaseDurationDays - daysRemaining) / leaseDurationDays * 100));

        // Monthly Chart Data
        const monthlyRentUtilityData = {
            labels: Object.keys(monthlyData).sort(),
            datasets: [
                { label: 'Rent Paid', data: Object.values(monthlyData).map(m => m.rentPaid), backgroundColor: '#28a745', borderColor: '#28a745', borderWidth: 1, fill: false },
                { label: 'Rent Expected', data: Object.values(monthlyData).map(m => m.expectedRent), backgroundColor: '#dc3545', borderColor: '#dc3545', borderWidth: 1, fill: false },
                { label: 'Utility Paid', data: Object.values(monthlyData).map(m => m.utilityPaid), backgroundColor: '#007bff', borderColor: '#007bff', borderWidth: 1, fill: false },
                { label: 'Utility Expected', data: Object.values(monthlyData).map(m => m.expectedUtility), backgroundColor: '#ff9800', borderColor: '#ff9800', borderWidth: 1, fill: false }
            ]
        };

        // Render Report
        res.render('tenancyManager/tenantReport', {
            tenant,
            payments,
            properties,
            totalRentPaid: totalRentPaid.toFixed(2),
            totalUtilityPaid: totalUtilityPaid.toFixed(2),
            rentDue: rentDue.toFixed(2),
            utilityDue: utilityDue.toFixed(2),
            totalPaid: totalPaid.toFixed(2),
            totalDue: totalDue.toFixed(2),
            overpayment: overpayment.toFixed(2),
            leaseStart: leaseStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            leaseEnd: leaseEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            leaseProgress,
            daysRemaining: Math.ceil(daysRemaining),
            monthlyRentDataArray: JSON.stringify(monthlyRentUtilityData),
            currentUser: req.user,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (error) {
        console.error('Tenant Report Error:', {
            message: error.message,
            stack: error.stack,
            tenantId: req.params.tenantId,
            userId: req.user?._id
        });
        req.flash('error', 'Unable to generate tenant report. Please try again.');
        res.redirect('/tenancy-manager/dashboard');
    }
});


// POST route to delete a tenant
router.post('/tenancy-manager/tenants/delete/:id', isTenancyManager, async (req, res) => {
    try {
        await Tenant.findByIdAndDelete(req.params.id);
        req.flash('success', 'Tenant deleted successfully.');
        res.redirect('/tenancy-manager/tenants');
    } catch (err) {
        req.flash('error', 'Error deleting tenant.');
        res.redirect('/tenancy-manager/tenants');
    }
});



// Handle Rent Payment Submission
router.post('/rent/pay', async (req, res) => {
    const { amount, paymentMethod } = req.body;

    try {
        const rentPayment = new Payment({
            tenantId: req.user._id,
            amount,
            method: paymentMethod,
            date: new Date(),
            status: 'Paid',
        });
        await rentPayment.save();

        res.status(200).json({ message: 'Rent payment successful.' });
    } catch (error) {
        console.error('Error processing rent payment:', error);
        res.status(500).json({ message: 'Error processing rent payment.' });
    }
});

// Handle Utility Payment Submission
router.post('/utilities/pay', async (req, res) => {
    const { amount, paymentMethod } = req.body;

    try {
        const utilityPayment = new Payment({
            tenantId: req.user._id,
            amount,
            method: paymentMethod,
            date: new Date(),
            status: 'Paid',
        });
        await utilityPayment.save();

        res.status(200).json({ message: 'Utility payment successful.' });
    } catch (error) {
        console.error('Error processing utility payment:', error);
        res.status(500).json({ message: 'Error processing utility payment.' });
    }
});

// Export the router
module.exports = router;
