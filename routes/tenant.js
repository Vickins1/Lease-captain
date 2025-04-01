const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant');
const Property = require('../models/property');
const Payment = require('../models/payment');
const {  checkRole,isTenancyManager } = require('../middleware');
const PropertyUnit = require('../models/unit');
const moment = require('moment') 


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
