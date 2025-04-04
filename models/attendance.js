const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  date: { type: Date, required: true },
  status: { type: String, enum: ['Present', 'Absent', 'Leave'], default: 'Present' },
  checkIn: { type: Date },
  checkOut: { type: Date }
});

module.exports = mongoose.model('Attendance', attendanceSchema);