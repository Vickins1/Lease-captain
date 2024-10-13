const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], required: true },
});

const Expense = mongoose.model('Expense', expenseSchema);

module.exports = Expense;
