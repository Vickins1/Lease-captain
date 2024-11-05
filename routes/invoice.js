const express = require('express');
const router = express.Router();
const Invoice = require('../models/invoice');
const User = require('../models/user');

// Create a new invoice for a user
router.post('/create', async (req, res) => {
    try {
        const { userId, items, totalAmount, dueDate } = req.body;

        const invoiceNumber = `INV-${Date.now()}`; 
        const invoice = new Invoice({
            user: userId, 
            invoiceNumber,
            items,
            totalAmount,
            dueDate: new Date(dueDate)
        });

        await invoice.save();
        res.status(201).json({ success: true, invoice });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

// Fetch all invoices for a user
router.get('/list/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const invoices = await Invoice.find({ user: userId });

        res.status(200).json({ success: true, invoices });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});
