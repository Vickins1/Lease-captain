const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
    type: {
        type: String, 
        required: true
    },
    subject: {
        type: String, 
        required: function () { return this.type === 'email'; }
    },
    content: {
        type: String, 
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Template = mongoose.model('Template', templateSchema);
module.exports = Template;
