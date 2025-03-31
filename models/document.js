const mongoose = require('mongoose');
const DocumentSchema = new mongoose.Schema({
       name: String,
       tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
       type: String,
       filePath: String,
       createdAt: { type: Date, default: Date.now }
   });
   const Document = mongoose.model('Document', DocumentSchema);
       module.exports = Document;