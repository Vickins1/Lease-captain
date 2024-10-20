const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
require('dotenv').config();
const Property = require('../models/property');
const Tenant = require('../models/tenant');
const { isTenancyManager } = require('../middleware');
const bcrypt = require('bcrypt');
const Payment = require('../models/payment');
const User = require('../models/user');
const PropertyUnit = require('../models/unit'); 
const Invoice = require('../models/invoice')
const Expense = require('../models/expense');
const Role = require('../models/role');
const permissions = require('../models/permissions');
const MaintenanceRequest = require('../models/maintenanceRequest');
const Account = require('../models/account');
const Topups = require('../models/topups');
const Reminder = require('../models/reminder');
const Template = require('../models/template');
const crypto = require('crypto');



router.get('/tenancy-manager/dashboard', isTenancyManager, async (req, res) => {
    try {
        // Fetch all properties owned by the user
        const properties = await Property.find({ owner: req.user._id }).populate('tenants');

        // Fetch all units for the properties
        const units = await PropertyUnit.find({ propertyId: { $in: properties.map(prop => prop._id) } }).populate('tenants');

        const numberOfUnits = units.length;
        const users = await User.countDocuments();
        const maintenanceRequests = await MaintenanceRequest.find();
        const totalRequests = maintenanceRequests.length;

        let totalRentCollected = 0;
        let totalRentDue = 0;
        let utilityCollected = 0;
        let utilityDue = 0;
        let numberOfTenants = 0;  // Initialize tenant count
        let occupiedUnitsCount = 0;  // Initialize occupied units count

        const rentCollectionData = {}; 

        // Iterate over units to calculate total tenants and occupied units
        units.forEach(unit => {
            numberOfTenants += unit.tenants.length;  // Sum tenants in each unit

            if (unit.tenants.length > 0) {
                occupiedUnitsCount += 1;  // Count the unit as occupied if it has tenants
            }

            // Aggregate rent and utility details from tenants
            unit.tenants.forEach(tenant => {
                totalRentCollected += tenant.rentPaid || 0;
                totalRentDue += tenant.rentDue || 0;
                utilityCollected += tenant.utilityPaid || 0;
                utilityDue += tenant.utilityDue || 0;

                const month = new Date(tenant.leaseEndDate).toLocaleString('default', { month: 'short' });

                if (!rentCollectionData[month]) rentCollectionData[month] = { collected: 0, due: 0 };
                rentCollectionData[month].collected += tenant.rentPaid || 0;
                rentCollectionData[month].due += tenant.rentDue || 0;
            });
        });

        const totalProperties = properties.length;
        const totalRent = properties.reduce((sum, property) => sum + (property.rent * property.tenants.length || 0), 0);
        const averageRent = totalProperties > 0 ? totalRent / totalProperties : 0;

        const upcomingLeaseExpirations = properties.reduce((count, property) => {
            property.tenants.forEach(tenant => {
                const leaseEndDate = tenant.leaseEndDate;
                if (leaseEndDate && new Date(leaseEndDate) > new Date()) {
                    count += 1;
                }
            });
            return count;
        }, 0);

        const rentDataArray = Object.keys(rentCollectionData).map(month => ({
            month,
            collected: rentCollectionData[month].collected,
            due: rentCollectionData[month].due
        }));

        // Pass the data to the template
        res.render('tenancyManager/dashboard', {
            properties,
            totalRentCollected,
            totalRentDue,
            utilityCollected,
            utilityDue,
            averageRent,
            upcomingLeaseExpirations,
            numberOfTenants,  // Pass the number of tenants to the template
            numberOfUnits,
            occupiedUnitsCount,  // Pass the occupied units count to the template
            users,
            totalRequests,
            rentDataArray,
            currentUser: req.user
        });
    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        req.flash('error', 'Error fetching dashboard data.');
        res.redirect('/login');
    }
});





// Serve User Profile Page
router.get('/tenancy-manager/profile', isTenancyManager, async (req, res) => {
    console.log('Session data:', req.session);

    try {
        
        if (!req.session.passport || !req.session.passport.user) {
            console.log('No user information in session.');
            req.flash('error', 'You need to log in to view this page.');
            return res.redirect('/login'); 
        }

        const userId = req.session.passport.user; 
        const user = await User.findById(userId);

        if (!user) {
            req.flash('error', 'User not found.');
            return res.status(404).redirect('/tenancy-manager/profile');
        }

        
        res.render('tenancyManager/profile', { user, currentUser: user });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        req.flash('error', 'An error occurred while fetching your profile. Please try again later.');
        res.status(500).redirect('/tenancy-manager/profile'); 
    }
});

// Serve User Security Page
router.get('/tenancy-manager/security', isTenancyManager, async (req, res) => {
    try {
        const userId = req.session.passport.user; 
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send('User not found');
        }

        // Pass the user and currentUser to the view
        res.render('tenancyManager/security', { user, currentUser: user });
    } catch (error) {
        console.error('Error fetching user security settings:', error);
        res.status(500).send('Error fetching user security settings');
    }
});

// Change Password Route
router.post('/tenancy-manager/security', isTenancyManager, async (req, res) => {
    try {
        const userId = req.session.passport.user; 
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send('User not found');
        }

        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate the current password using the authenticate method
        user.authenticate(currentPassword, async (err, authenticatedUser) => {
            if (err || !authenticatedUser) {
                req.flash('error', 'Current password is incorrect.');
                return res.redirect('/tenancy-manager/security');
            }

            // Check if new passwords match
            if (newPassword !== confirmPassword) {
                req.flash('error', 'New passwords do not match.');
                return res.redirect('/tenancy-manager/security');
            }

            // Set the new password
            user.setPassword(newPassword, async (err) => {
                if (err) {
                    req.flash('error', 'Error setting new password.');
                    return res.redirect('/tenancy-manager/security');
                }
                await user.save(); // Save user after setting the password
                req.flash('success', 'Password changed successfully!');
                res.redirect('/tenancy-manager/security');
            });
        });
    } catch (error) {
        console.error('Error changing password:', error);
        req.flash('error', 'An error occurred while changing the password.');
        res.redirect('/tenancy-manager/security');
    }
});





// Update User Profile
router.post('/tenancy-manager/profile', isTenancyManager, async (req, res) => {
    try {
        const userId = req.session.passport.user;
        const { username, email } = req.body;

        const updates = { username, email };
        

        const updatedUser = await User.findByIdAndUpdate(userId, updates, { new: true });
        if (!updatedUser) return res.status(404).send('User not found');

        req.flash('success', 'Profile updated successfully!');
        res.redirect('/tenancy-manager/profile');
    } catch (error) {
        console.error('Error updating user profile:', error);
        req.flash('error', 'Failed to update profile.');
        res.redirect('/tenancy-manager/profile');
    }
});




const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vickinstechnologies@gmail.com',
        pass: 'vnueayfgjstaazxh'
    }
});


// Route to handle form submission for new tenant
router.post('/tenancy-manager/tenant/new', async (req, res) => {
    const { name, email, address, phone, leaseStartDate, leaseEndDate, property, deposit, utilities, unitId, doorNumber } = req.body;

    // Validate presence of required fields
    if (!leaseStartDate) {
        req.flash('error', 'Lease start date is required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!leaseEndDate) {
        req.flash('error', 'Lease end date is required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!property) {
        req.flash('error', 'Property is required');
        return res.redirect('/tenancy-manager/tenants');
    }

    if (!name) {
        req.flash('error', 'Name is required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!email) {
        req.flash('error', 'Email is required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!deposit) {
        req.flash('error', 'Deposit is required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!utilities) {
        req.flash('error', 'Utilities are required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!unitId) {
        req.flash('error', 'Unit ID is required');
        return res.redirect('/tenancy-manager/tenants');
    }
    if (!doorNumber) {
        req.flash('error', 'Door number is required');
        return res.redirect('/tenancy-manager/tenants');
    }

    const currentUser = req.user;

    try {
        const propertyToCheck = await Property.findById(property);
        if (!propertyToCheck) {
            req.flash('error', 'Property not found');
            return res.redirect('/tenancy-manager/tenants');
        }
        const propertyName = propertyToCheck.name;
    
        if (propertyToCheck.owner.toString() !== currentUser._id.toString()) {
            req.flash('error', 'You do not have permission to add tenants to this property');
            return res.redirect('/tenancy-manager/tenants');
        }
    
        // Check if the tenant name is already taken
        const existingTenant = await Tenant.findOne({ name });
        if (existingTenant) {
            req.flash('error', `Tenant with name ${name} already exists. Please try again.`);
            return res.redirect('/tenancy-manager/tenants');
        }
    
        // Set default password
        const defaultPassword = '12345678';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    
        // Initialize wallet balance as the negative of the deposit amount
        const walletBalance = -deposit;
    
        // Use the tenant's name directly as the username
        const username = name.toLowerCase().replace(/\s+/g, '');

        const newTenant = new Tenant({
            name,
            email,
            address,
            phone,
            deposit,
            utilities,
            username,
            password: hashedPassword,
            leaseStartDate,
            leaseEndDate,
            property,
            owner: currentUser._id,
            userId: currentUser._id,
            unit: unitId,
            doorNumber,
            walletBalance,
        });

        await newTenant.save();

        // Email tenant with their credentials
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Lease Captain Tenant Portal Logins!',
            html: `<!DOCTYPE html>
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
        .content h2, 
        .content p {
            color: #000000;
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
        .footer {
            text-align: center;
            padding: 10px;
            color: #000000;
            font-size: 12px;
            border-top: 1px solid #003366;
            margin-top: 20px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to Lease Captain Tenant Portal</h1>
        </div>
        <div class="content">
            <h2>Dear ${name},</h2>
            <p>Welcome to your new home at <strong>${propertyName}</strong>! Your account has been successfully created. You can now access your tenant portal to manage your account.</p>
            <h3>Your Account Details:</h3>
            <p><strong>Username:</strong> ${name}<br><strong>Password:</strong> ${defaultPassword}</p>
            <h3>How to Log In:</h3>
            <p>Click the link below to access the Tenant Portal:</p>
            <p><a href="http://localhost:4000/tenantPortal/login" class="cta-button text-white"><strong>Access Your Tenant Portal</strong></a></p>
            <p>Once logged in, we recommend changing your password for security purposes.</p>
            <h3>Next Steps:</h3>
            <ul>
                <li>View your property details</li>
                <li>Make rent payments</li>
                <li>Submit maintenance requests</li>
                <li>Communicate with management</li>
            </ul>
            <p>Contact support in case of any queries</p>
        </div>
        <div class="footer">
            <p>&copy; 2024 Lease Captain. All Rights Reserved</p>
        </div>
    </div>
</body>
</html>
`,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${email}`);

        req.flash('success', 'Tenant added successfully and email sent!');
        res.redirect('/tenancy-manager/tenants');
    } catch (error) {
        console.error('Error adding tenant or sending email:', error);
        req.flash('error', 'Error adding tenant or sending email');
        res.redirect('/tenancy-manager/tenants');
    }
});



router.get('/tenancy-manager/payments', isTenancyManager, async (req, res) => {
    try {
        const pageSize = 10;
        const currentPage = Number(req.query.page) || 1;
        const searchQuery = req.query.search || '';
        const regex = new RegExp(searchQuery, 'i');
        const searchCondition = { tenantName: regex };

        const totalPayments = await Payment.countDocuments(searchCondition);

        const payments = await Payment.find(searchCondition)
            .populate({
                path: 'tenant',
                populate: [
                    { path: 'property', select: 'name' },
                    { path: 'unit', select: 'name' }  
                ]
            })
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize)
            .sort({ datePaid: -1 });

        const totalPages = Math.ceil(totalPayments / pageSize);
        const currentUser = req.user || null;

        // Flash messages can be set here as needed
        req.flash('success', 'Payments fetched successfully.'); 

        res.render('tenancyManager/payments', {
            title: 'Manage Payments',
            payments,
            currentPage,
            totalPages,
            pageSize,
            currentUser,
            searchQuery,
        });
    } catch (error) {
        console.error("Error fetching payments:", error);
        req.flash('error', 'Internal Server Error while fetching payments.');
        res.redirect('/tenancy-manager/payments'); 
    }
});









// Route for Reports & Invoices page
router.get('/reports-invoices', async (req, res) => {
    try {
        const currentPage = req.query.page || 1;
        const pageSize = 10;
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }
        
        const totalRecords = await Payment.countDocuments();
        const paginatedReports = await Payment.find()
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);
        
        
        const invoices = await Invoice.find(); 

        res.render('tenancyManager/reports&invoices', {
            reports: paginatedReports,
            invoices: invoices, 
            currentPage: parseInt(currentPage),
            pageSize,
            totalRecords,
            currentUser: req.user  
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

router.get('/expenses', async (req, res) => {
    try {
        const pageSize = 10; 
        const currentPage = Number(req.query.page) || 1; 
        const searchQuery = req.query.search || ''; 
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }
        
        const expenses = await Expense.find({
            name: { $regex: searchQuery, $options: 'i' }
        })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize);

        
        const totalExpenses = await Expense.countDocuments({
            name: { $regex: searchQuery, $options: 'i' }
        });

        const totalPages = Math.ceil(totalExpenses / pageSize); 

       
        const currentUser = req.user; 

        
        res.render('tenancyManager/expense', {
            expenses,
            currentPage,
            totalPages,
            pageSize,
            currentUser
        });
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Create New Expense Route
router.post('/expenses', async (req, res) => {
    try {
        const { name, category, amount, date, status } = req.body;

        
        const newExpense = new Expense({
            name,
            category,
            amount,
            date,
            status
        });

       
        await newExpense.save();

        req.flash('success', 'Expense created successfully!');
        res.redirect('/expenses');
    } catch (error) {
        console.error(error);
        req.flash('error', 'An error occurred while creating the expense. Please try again.');
        res.redirect('/expenses');
    }
});

// Pass the predefined permissions to the view
router.get('/roles', async (req, res) => {
    try {
        const roles = await Role.find();
        res.render('tenancyManager/roles', { 
            roles, 
            currentUser: req.user, 
            permissions,
            error: null, 
            success: null 
        });
    } catch (err) {
        res.render('tenancyManager/roles', { 
            roles: [], 
            permissions, 
            error: 'Error fetching roles.', 
            success: null 
        });
    }
});

// Create role route
router.post('/roles', async (req, res) => {
    const { roleName, permissions: selectedPermissions } = req.body; 

    try {
        const newRole = new Role({ 
            name: roleName,
            permissions: selectedPermissions || [] 
        });
        await newRole.save(); 
        res.redirect('/roles'); 
    } catch (err) {
        res.render('tenancyManager/roles', { 
            roles: await Role.find(), 
            currentUser: req.user, 
            permissions, 
            error: 'Error creating role.', 
            success: null 
        });
    }
});
// Users route
router.get('/users', isTenancyManager, async (req, res) => {
    try {
        const users = await User.find({ createdBy: req.user._id });
        const roles = await Role.find();
        res.render('tenancyManager/users', { 
            users, 
            roles, 
            currentUser: req.user, 
            error: null, 
            success: null 
        });
    } catch (err) {
        res.render('tenancyManager/users', { 
            users: [], 
            roles: [], 
            currentUser: req.user, 
            error: 'Error fetching users.', 
            success: null 
        });
    }
});


// Create the user
router.post('/users/create', isTenancyManager, async (req, res) => {
    try {
        const { username, email, password, roleId } = req.body;

        
        const user = new User({
            username,
            email,
            password, 
            role: roleId
        });

        await user.save();

        res.redirect('/users'); 
    } catch (err) {
        res.render('tenancyManager/users', {
            users: [], 
            roles: [],
            currentUser: req.user,
            error: 'Error creating user',
            success: null
        });
    }
});



// Route to assign role to a user
router.post('/users/:id/assign-role', async (req, res) => {
    const { roleId } = req.body;

    try {
        await User.findByIdAndUpdate(req.params.id, { role: roleId }); 
        res.redirect('/users'); 
    } catch (err) {
        res.redirect('/users?error=Error assigning role');
    }
});

// GET maintenance requests
router.get('/maintenance-requests', isTenancyManager, async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        const tenants = await Tenant.find({ owner: req.user._id }).select('_id');

        const requests = await MaintenanceRequest.find({ tenantId: { $in: tenants } })
            .populate('tenantId propertyId');

        const messages = {
            success: req.flash('success'), 
            error: req.flash('error')
        };

        res.render('tenancyManager/maintenanceRequest', {
            requests,
            currentUser: req.user,
            messages 
        });
    } catch (err) {
        console.error('Error fetching maintenance requests:', err);
        req.flash('error', 'Error fetching maintenance requests.');
        res.redirect('/tenancy-manager/dashboard');
    }
});

//POST Maintenance Request
router.post('/maintenance-requests/:id', isTenancyManager, async (req, res) => {
    try {

        const { id } = req.params;

        const { status } = req.body;

        await MaintenanceRequest.findByIdAndUpdate(id, { status }, { new: true });

        req.flash('success', 'Maintenance request updated successfully.');

        res.redirect('/maintenance-requests');

    } catch (err) {

        console.error('Error updating maintenance request:', err);

        req.flash('error', 'Error updating maintenance request.');
        
        res.redirect('/maintenance-requests');
    }
});


// Route to schedule maintenance
router.post('/schedule', async (req, res) => {
    const { requestId, scheduleDate, scheduleDescription } = req.body;

    try {
        // Find the maintenance request by ID
        const request = await MaintenanceRequest.findById(requestId);
        if (!request) {
            return res.status(404).send('Maintenance request not found');
        }

        request.scheduleDate = scheduleDate;
        request.description = scheduleDescription || request.description; 
        request.status = 'in-progress'; 

        await request.save();
        res.status(200).send('Maintenance scheduled successfully');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});




router.get('/connect', async (req, res) => {
    if (!req.user) {
        req.flash('error', 'User not authenticated.');
        return res.redirect('/login');
    }

    try {
       
        const connectedAccounts = await Account.find({ userId: req.user._id }).lean(); 

      
        res.render('tenancyManager/connectAccount', {
            currentUser: req.user,
            messages: {
                success: req.flash('success'),
                error: req.flash('error'),
            },
            connectedAccounts: connectedAccounts 
        });
    } catch (error) {
        console.error('Error fetching connected accounts:', error);
        req.flash('error', 'Failed to fetch connected accounts.');
        res.render('tenancyManager/connectAccount', {
            currentUser: req.user,
            messages: {
                success: req.flash('success'),
                error: req.flash('error'),
            },
            connectedAccounts: []
        });
    }
});


router.post('/connect', async (req, res) => {
    const { accountEmail, apiKey, accountId, status, webhookUrl } = req.body;

    if (!accountEmail || !apiKey || !accountId || !status) {
        req.flash('error', 'All required fields must be filled');
        return res.redirect('/connect');
    }

    const userId = req.user._id; 
    try {
        const newAccount = new Account({
            userId, 
            accountEmail,
            apiKey,
            accountId,
            status,
            webhookUrl
        });

        await newAccount.save();

        console.log('Form Data Saved:', newAccount);

        req.flash('success', 'Account connected and saved successfully!');
        res.redirect('/connect');
    } catch (error) {
        console.error('Error saving account:', error);
        req.flash('error', 'Server error, please try again later.');
        res.redirect('/connect');
    }
});




router.post('/edit/:id', async (req, res) => {
    const accountId = req.params.id;
    const { accountEmail, apiKey, accountId: newAccountId, status, webhookUrl } = req.body;

    try {
        await Account.findByIdAndUpdate(accountId, {
            accountEmail,
            apiKey,
            accountId: newAccountId,
            status,
            webhookUrl
        });

        res.redirect('/connect');
    } catch (error) {
        console.error('Error updating account:', error);
        res.status(500).send('Internal Server Error'); 
    }
});

// Delete account route
router.post('/delete/:id', async (req, res) => {
    const accountId = req.params.id;

    try {
        // Find the account by ID and delete it
        await Account.findByIdAndDelete(accountId);

        
        res.redirect('/connect'); 
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).send('Internal Server Error');
    }
});



// Get top-up page
router.get('/top-ups', isTenancyManager, async (req, res) => {
    try {
        const topups = await Topups.find({ createdBy: req.user._id }); 
        res.render('tenancyManager/topups', { 
            topups, 
            currentUser: req.user, 
            error: null, 
            success: null 
        });
    } catch (err) {
        res.render('tenancyManager/topups', { 
            topups: [], 
            currentUser: req.user, 
            error: 'Error fetching top-ups.', 
            success: null 
        });
    }
});


//GET sms&email
router.get('/sms&email', isTenancyManager, async (req, res) => {
    try {
        const templates = await Template.find({ createdBy: req.user._id });

        const reminders = await Reminder.find({ userId: req.user._id }).populate('templateId'); 

        res.render('tenancyManager/sms&email', {
            templates,        
            reminders,        
            currentUser: req.user, 
            success: req.flash('success'), 
            error: req.flash('error')     
        });
    } catch (err) {
        console.error(err);
        res.render('tenancyManager/sms&email', {
            templates: [],   
            reminders: [],  
            currentUser: req.user,
            error: 'Error fetching templates and reminders.'
        });
    }
});


// Create a new template
router.post('/templates/create', isTenancyManager, async (req, res) => {
    try {
        const { type, subject, content } = req.body;
        const template = new Template({
            type,
            subject: type === 'email' ? subject : undefined,
            content,
            createdBy: req.user._id
        });
        await template.save();
        res.redirect('/templates');
    } catch (err) {
        res.render('tenancyManager/templates', { templates: [], currentUser: req.user, error: 'Error creating template.' });
    }
});


// Create a new reminder
router.post('/reminders/create', isTenancyManager, async (req, res) => {
    try {
        const { templateId, sendAt, frequency } = req.body;

        const reminder = new Reminder({
            template: templateId,
            sendAt: new Date(sendAt),
            frequency,
            createdBy: req.user._id
        });

        await reminder.save();
        res.redirect('/reminders');
    } catch (err) {
        res.render('tenancyManager/reminders', { reminders: [], currentUser: req.user, error: 'Error creating reminder.' });
    }
});

// Add a new top-up
router.post('/topups', isTenancyManager, async (req, res) => {
    try {
        const { amount } = req.body;
        const newTopup = new Topup({
            amount,
            createdBy: req.user._id
        });
        await newTopup.save();
        res.redirect('/topups'); 
    } catch (err) {
        console.error(err);
        res.render('tenancyManager/topups', {
            topups: await Topup.find({ createdBy: req.user._id }),
            currentUser: req.user,
            error: 'Error adding top-up.',
            success: null
        });
    }
});



// POST route for "Forgot Password"
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            req.flash('errorMessage', 'No user found with that email address.');
            return res.redirect('/login');
        }
        const resetToken = crypto.randomBytes(20).toString('hex');

        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000;

        await user.save();

        const mailOptions = {
            to: user.email,
            from: 'vickinstechnologies.com',
            subject: 'Lease Captain Password Reset',
            text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n
            Please click on the following link, or paste this into your browser to complete the process:\n\n
            http://${req.headers.host}/reset-password/${resetToken}\n\n
            If you did not request this, please ignore this email and your password will remain unchanged.\n`,
        };

        await transporter.sendMail(mailOptions);

        req.flash('successMessage', 'A password reset link has been sent to your email.');
        res.redirect('/login');
    } catch (error) {
        console.error('Error in forgot-password route:', error);
        req.flash('errorMessage', 'Error sending password reset email.');
        res.redirect('/login');
    }
});


// GET route to show reset password form
router.get('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).send('Password reset token is invalid or has expired.');
        }

        res.render('reset-password', { token: req.params.token });
    } catch (error) {
        res.status(500).send('Error retrieving user.');
    }
});


// POST route to reset the password
router.post('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).send('Password reset token is invalid or has expired.');
        }

        const { password, confirmPassword } = req.body;
        if (password !== confirmPassword) {
            return res.status(400).send('Passwords do not match.');
        }

        user.password = await user.hashPassword(password);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;

        await user.save();

        res.status(200).send('Password has been successfully reset.');
    } catch (error) {
        res.status(500).send('Error resetting password.');
    }
});

module.exports = router;
