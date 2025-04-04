const express = require('express');
const router = express.Router();
const Land = require('../models/land');
const LandParcel = require('../models/landParcel');
const LandReport = require('../models/landReport');
const Vehicle = require('../models/vehicle');
const ParkingSpace = require('../models/parkingSpace');
const VehicleReport = require('../models/vehicleReport');
const Staff = require('../models/staff');
const Attendance = require('../models/attendance');
const Payroll = require('../models/payroll');
const Budget = require('../models/budget');
const Lease = require('../models/lease'); // Assuming you have a Lease model
// Authentication middleware
const ensureAuthenticated = (req, res, next) => {
       if (req.isAuthenticated()) {
           return next();
       }
       res.redirect('/login');
   };

// Lands Page
router.get('/tenancy-manager/lands', ensureAuthenticated, async (req, res) => {
  const lands = await Land.find();
  res.render('tenancyManager/lands', { lands,  currentUser: req.user });
});

// Land Parcels Page
router.get('/tenancy-manager/land-parcels', ensureAuthenticated, async (req, res) => {
  const parcels = await LandParcel.find().populate('landId');
  const lands = await Land.find(); // For dropdown in modal
  res.render('tenancyManager/land-parcels', { parcels, currentUser: req.user, lands });
});

// Land Reports Page
router.get('/tenancy-manager/land-reports', ensureAuthenticated, async (req, res) => {
       const reports = await LandReport.find().populate('landId');
       const lands = await Land.find(); // Fetch all lands for the table
       const availableLands = await Land.countDocuments({ status: 'Available' });
       const leasedLands = await Land.countDocuments({ status: 'Leased' });
       const totalRevenue = reports.reduce((sum, report) => sum + report.revenue, 0);
     
       res.render('tenancyManager/land-reports', { reports, currentUser: req.user, lands, availableLands, leasedLands, totalRevenue });
     });

// POST route for creating a new land
router.post('/lands', async (req, res) => {
  const { name, location, size, owner } = req.body;
  const newLand = new Land({ name, location, size, owner });
  await newLand.save();
  res.redirect('/tenancy-manager/lands');
});

// POST route for creating a new land parcel
router.post('/land-parcels', async (req, res) => {
  const { landId, parcelNumber, size } = req.body;
  const newParcel = new LandParcel({ landId, parcelNumber, size });
  await newParcel.save();
  res.redirect('/tenancy-manager/land-parcels');
});


router.get('/tenancy-manager/vehicles', ensureAuthenticated, async (req, res) => {
       const vehicles = await Vehicle.find();
       res.render('tenancyManager/vehicles', { vehicles, currentUser: req.user, message: req.flash('message') });
     });
     
     // Parking Spaces Page
     router.get('/tenancy-manager/vehicle-parking', ensureAuthenticated, async (req, res) => {
       const parkingSpaces = await ParkingSpace.find().populate('vehicleId');
       const vehicles = await Vehicle.find(); // For dropdown in modal
       res.render('tenancyManager/vehicle-parking', { parkingSpaces, currentUser: req.user, vehicles });
     });
     
     // Vehicle Reports Page
     router.get('/tenancy-manager/vehicle-reports', ensureAuthenticated, async (req, res) => {
       const reports = await VehicleReport.find().populate('vehicleId');
       const registeredVehicles = await Vehicle.countDocuments({ status: 'Registered' });
       const unregisteredVehicles = await Vehicle.countDocuments({ status: 'Unregistered' });
       const totalParkingFees = reports.reduce((sum, report) => sum + report.parkingFee, 0);
     
       res.render('tenancyManager/vehicle-reports', { reports, currentUser: req.user, registeredVehicles, unregisteredVehicles, totalParkingFees });
     });
     
     // POST route for creating a new vehicle
     router.post('/vehicles', async (req, res) => {
       const { licensePlate, make, model, owner } = req.body;
       const newVehicle = new Vehicle({ licensePlate, make, model, owner });
       await newVehicle.save();
       res.redirect('/tenancy-manager/vehicles');
     });
     
     // POST route for creating a new parking space
     router.post('/vehicle-parking', async (req, res) => {
       const { spaceNumber, vehicleId, location } = req.body;
       const newParkingSpace = new ParkingSpace({ spaceNumber, vehicleId: vehicleId || null, location });
       await newParkingSpace.save();
       res.redirect('/tenancy-manager/vehicle-parking');
     });

     // Staff Directory Page
router.get('/staff-directory', ensureAuthenticated, async (req, res) => {
       const staff = await Staff.find();
       res.render('staff-directory', { staff, currentUser: req.user });
     });
     
     // Attendance Page
     router.get('/staff-attendance', ensureAuthenticated, async (req, res) => {
       const attendanceRecords = await Attendance.find().populate('staffId');
       const staff = await Staff.find(); // For dropdown in modal
       res.render('staff-attendance', { attendanceRecords, staff, currentUser: req.user });
     });
     
     // Payroll Page
     router.get('/staff-payroll', ensureAuthenticated, async (req, res) => {
       const payrollRecords = await Payroll.find().populate('staffId');
       const staff = await Staff.find();
       const totalSalary = payrollRecords.reduce((sum, record) => sum + record.salary, 0);
       const totalNetPay = payrollRecords.reduce((sum, record) => sum + record.netPay, 0);
       const paidRecords = payrollRecords.filter(record => record.paid).length;
     
       res.render('staff-payroll', { payrollRecords, staff, currentUser: req.user, totalSalary, totalNetPay, paidRecords });
     });
     
     // POST route for adding a new staff member
     router.post('/staff-directory', async (req, res) => {
       const { name, email, role, phone } = req.body;
       const newStaff = new Staff({ name, email, role, phone });
       await newStaff.save();
       res.redirect('/staff-directory');
     });
     
     // POST route for recording attendance
     router.post('/staff-attendance', async (req, res) => {
       const { staffId, date, status, checkIn, checkOut } = req.body;
       const newAttendance = new Attendance({
         staffId,
         date,
         status,
         checkIn: checkIn || null,
         checkOut: checkOut || null
       });
       await newAttendance.save();
       res.redirect('/staff-attendance');
     });
     
     // POST route for creating payroll
     router.post('/staff-payroll', async (req, res) => {
       const { staffId, month, salary, deductions } = req.body;
       const netPay = salary - (deductions || 0);
       const newPayroll = new Payroll({ staffId, month, salary, deductions, netPay });
       await newPayroll.save();
       res.redirect('/staff-payroll');
     });

     // Budget Planning Page
router.get('/budget-planning',ensureAuthenticated, async (req, res) => {
       // Fetch data from various models
       const leases = await Lease.find();
       const lands = await Land.find();
       const vehicles = await Vehicle.find();
       const payrollRecords = await Payroll.find();
       const budgets = await Budget.find();
     
       // Calculate totals
       const leaseRevenue = leases.reduce((sum, lease) => sum + (lease.status === 'Active' ? 1000 : 0), 0); // Placeholder: assume $1000 per active lease
       const landRevenue = lands.reduce((sum, land) => sum + (land.status === 'Leased' ? 500 : 0), 0); // Placeholder: $500 per leased land
       const parkingFees = vehicles.length * 50; // Placeholder: $50 per vehicle
       const staffExpenses = payrollRecords.reduce((sum, record) => sum + record.netPay, 0);
       const totalBudget = budgets.reduce((sum, budget) => sum + budget.amount, 0);
     
       res.render('budget-planning', {
         leases,
         lands,
         vehicles,
         payrollRecords,
         budgets,
         leaseRevenue,
         landRevenue,
         parkingFees,
         staffExpenses,
         totalBudget,
               currentUser: req.user,
       });
     });
     
     // POST route for creating a new budget
     router.post('/budget-planning', async (req, res) => {
       const { category, amount, period, description } = req.body;
       const newBudget = new Budget({ category, amount, period, description });
       await newBudget.save();
       res.redirect('/budget-planning');
     });
     
module.exports = router;