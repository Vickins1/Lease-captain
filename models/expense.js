const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, 
    expenseId: { type: String, unique: true, default: () => `EXP-${Date.now()}-${Math.floor(Math.random() * 10000)}` },
    name: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], required: true },
});

const Expense = mongoose.model('Expense', expenseSchema);

module.exports = Expense;
