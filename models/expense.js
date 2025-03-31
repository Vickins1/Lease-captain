const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expenseId: { type: String, unique: true, default: () => `EXP-${Date.now()}-${Math.floor(Math.random() * 10000)}` },
    name: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', required: true },
    paymentMethod: { type: String, enum: ['Cash', 'Credit Card', 'Debit Card', 'Mobile Payment', 'Bank Transfer'], required: true },
    receipt: { type: String }, // URL or file path to uploaded receipt (e.g., stored in cloud storage)
    notes: { type: String }, // Optional notes or description
    tags: [{ type: String }], // Array of tags for filtering (e.g., "Business", "Travel")
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // User who approved/rejected
    approvalDate: { type: Date }, // Date of approval/rejection
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Middleware to update `updatedAt` on save
expenseSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Expense = mongoose.model('Expense', expenseSchema);

module.exports = Expense;