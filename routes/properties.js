const express = require('express');
const router = express.Router();
const Property = require('../models/property');
const PropertyUnit = require('../models/unit');
const { isTenancyManager } = require('../middleware');

router.get('/tenancy-manager/properties', isTenancyManager, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const properties = await Property.aggregate([
            {
                $match: { owner: req.user._id }
            },
            {
                $lookup: {
                    from: 'propertyunits',
                    localField: '_id',
                    foreignField: 'propertyId',
                    as: 'units'
                }
            },
            {
                $unwind: {
                    path: '$units',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'tenants',
                    localField: 'units.tenantId',
                    foreignField: '_id',
                    as: 'units.tenants'
                }
            },
            {
                $unwind: {
                    path: '$units.tenants',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'payments',
                    localField: 'units._id',
                    foreignField: 'unitId',
                    as: 'units.payments'
                }
            },
            {
                $addFields: {
                    // Calculate total paid rent and utilities
                    totalPaidRent: {
                        $sum: {
                            $map: {
                                input: '$units.payments',
                                as: 'payment',
                                in: { $ifNull: ['$$payment.amount', 0] }
                            }
                        }
                    },
                    totalPaidUtilities: {
                        $sum: {
                            $map: {
                                input: '$units.payments',
                                as: 'payment',
                                in: { $ifNull: ['$$payment.utilitiesAmount', 0] }
                            }
                        }
                    },
                    // Calculate dues based on unit prices and paid amounts
                    rentDue: {
                        $let: {
                            vars: {
                                rentDue: { $ifNull: ['$units.rentDue', 0] },
                                monthsElapsed: {
                                    $floor: {
                                        $divide: [
                                            { 
                                                $subtract: [
                                                    new Date(), 
                                                    { 
                                                        $toDate: { 
                                                            $arrayElemAt: ['$units.tenants.leaseStart', 0] 
                                                        } 
                                                    }
                                                ]
                                            },
                                            1000 * 60 * 60 * 24 * 30 
                                        ]
                                    }
                                }
                            },
                            in: {
                                $multiply: ['$$rentDue', '$$monthsElapsed']
                            }
                        }
                    },
                    utilitiesDue: {
                        $let: {
                            vars: {
                                utilitiesDue: { $ifNull: ['$units.utilitiesDue', 0] },
                                monthsElapsed: {
                                    $floor: {
                                        $divide: [
                                            { 
                                                $subtract: [
                                                    new Date(), 
                                                    { 
                                                        $toDate: { 
                                                            $arrayElemAt: ['$units.tenants.leaseStart', 0] 
                                                        } 
                                                    }
                                                ]
                                            },
                                            1000 * 60 * 60 * 24 * 30
                                        ]
                                    }
                                }
                            },
                            in: {
                                $multiply: ['$$utilitiesDue', '$$monthsElapsed']
                            }
                        }
                    },
                    isVacant: {
                        $cond: {
                            if: { $eq: [{ $size: { $ifNull: ['$units.tenants', []] } }, 0] },
                            then: true, 
                            else: false 
                        }
                    }
                }
            },
            {
                $group: {
                    _id: '$_id',
                    name: { $first: '$name' },
                    address: { $first: '$address' },
                    paymentDay: { $first: '$paymentDay' },
                    propertyType: { $first: '$propertyType' },
                    rentCollected: {
                        $sum: {
                            $reduce: {
                                input: '$units.payments',
                                initialValue: 0,
                                in: { $add: ['$$value', { $ifNull: ['$$this.amount', 0] }] }
                            }
                        }
                    },
                    utilitiesCollected: {
                        $sum: {
                            $reduce: {
                                input: '$units.payments',
                                initialValue: 0,
                                in: { $add: ['$$value', { $ifNull: ['$$this.utilitiesAmount', 0] }] }
                            }
                        }
                    },
                    totalRentDue: { $sum: '$rentDue' },
                    totalUtilitiesDue: { $sum: '$utilitiesDue' },
                    totalDue: { $sum: { $add: ['$rentDue', '$utilitiesDue'] } },
                    numberOfUnits: { $sum: 1 },
                    vacancies: { $sum: { $cond: [{ $eq: ['$isVacant', true] }, 1, 0] } } 
                }
            },
            {
                $addFields: {
                    status: {
                        $cond: {
                            if: { $gt: ['$vacancies', 0] },
                            then: 'Vacancies available',
                            else: 'Fully occupied'
                        }
                    }
                }
            },
            {
                $skip: skip
            },
            {
                $limit: limit
            }
        ]);

        // Calculate total properties and pages for pagination
        const totalProperties = await Property.countDocuments({ owner: req.user._id });
        const totalPages = Math.ceil(totalProperties / limit);

        // Render the properties page
        res.render('tenancyManager/properties', {
            properties,
            currentUser: req.user,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Error fetching properties.');
        res.redirect('/tenancyManager/dashboard');
    }
});

  




router.get('/tenancy-manager/property/units', isTenancyManager, async (req, res) => {
    try {
        // Ensure user is authenticated
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        // Fetch property units where the property owner is the current user
        const units = await PropertyUnit.find()
            .populate('tenants') 
            .populate({
                path: 'propertyId',
                match: { owner: req.user._id }, 
                select: 'name' 
            })
            .setOptions({ strictPopulate: false }) 
            .exec();

       
        const filteredUnits = units.filter(unit => unit.propertyId !== null);

        
        const unitsWithInfo = filteredUnits.map(unit => {
            
            const utilitiesAmount = unit.utilities.reduce((total, utility) => total + utility.amount, 0);
            return {
                id: unit._id, 
                unitName: unit.unitName,
                unitType: unit.unitType,
                unitCount: unit.unitCount,
                unitPrice: unit.unitPrice,
                vacantUnits: unit.vacantUnits,
                description: unit.description,
                tenants: unit.tenants.length || 0, 
                property: unit.propertyId.name,
                utilitiesAmount: utilitiesAmount,
                totalRentCollected: unit.totalRentCollected || 0, 
                rentDue: unit.rentDue || 0, 
                totalUtilitiesPaid: unit.totalUtilitiesCollected || 0,
                utilitiesDue: unit.utilitiesDue || 0,
                deposit: unit.deposit || 0 
            };
        });

        // Fetch properties for the current user
        const properties = await Property.find({ owner: req.user._id }, 'name');

        
        res.render('tenancyManager/units', { 
            units: unitsWithInfo, 
            properties: properties,
            currentUser: req.user
        });

    } catch (err) {
        console.error('Error fetching property units:', err);
        req.flash('error', 'Error fetching property units.');
        res.redirect('/tenancy-manager/dashboard');
    }
});




// GET route to fetch units for a specific property
router.get('/tenancy-manager/units/:propertyId', async (req, res) => {
    try {
        const propertyId = req.params.propertyId;

        // Fetch units associated with the selected property
        const units = await Unit.find({ property: propertyId }); 

        res.json(units);
    } catch (err) {
        console.error('Error fetching units:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



// Create Property Unit
router.post('/tenancy-manager/property/units', isTenancyManager, async (req, res) => {
    try {
        
        const { propertyId, unitName, unitType, unitCount, unitPrice, description, vacantUnits, utilities, depositAmount } = req.body;

        // Validate required fields
        if (!propertyId || !unitName || !unitType || !unitCount || !unitPrice || vacantUnits === undefined || !utilities || depositAmount === undefined) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/tenancy-manager/property/units');
        }

        // Create a new PropertyUnit instance
        const newUnit = new PropertyUnit({
            propertyId,
            unitName,
            unitType,
            unitCount,
            unitPrice,
            vacantUnits,
            description,
            utilities, 
            deposit: depositAmount 
        });

        await newUnit.save();

        req.flash('success', 'Property unit added successfully!');
        res.redirect('/tenancy-manager/property/units');
    } catch (error) {
        console.error('Error adding unit:', error);
        req.flash('error', 'Error adding unit: ' + error.message);
        res.redirect('/tenancy-manager/property/units');
    }
});




// Create Property
router.post('/tenancy-manager/property', isTenancyManager, async (req, res) => {
    const { name, address, paymentDay, propertyType, rentCollected } = req.body;

    // Input Validation
    if (!name || !address || !paymentDay || !propertyType) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/tenancy-manager/property/new');
    }

    // Parse and validate rentCollected if it's expected to be a number
    const parsedRentCollected = parseFloat(rentCollected);
    if (isNaN(parsedRentCollected) || !isFinite(parsedRentCollected)) {
        req.flash('error', 'Rent collected must be a valid number.');
        return res.redirect('/tenancy-manager/property/new');
    }

    try {
        // Create a new property object
        const newProperty = new Property({
            name,
            address,
            paymentDay, 
            propertyType,
            rentCollected: parsedRentCollected, 
            owner: req.user._id,
        });

        await newProperty.save();

        req.flash('success', 'Property added successfully!');
        res.redirect('/tenancy-manager/properties'); 
    } catch (err) {
        console.error(err);
        req.flash('error', 'Error adding property: ' + err.message);
        res.redirect('/tenancy-manager/property/new'); 
    }
});


// Edit property
router.post('/tenancy-manager/property/edit/:id', isTenancyManager, async (req, res) => {
    try {
        const { name, address, rentCollected, rentDue, propertyType, paymentDay, utilitiesCollected, utilitiesDue } = req.body;

        // Input validation
        if (!name || !address || !propertyType || !paymentDay) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/tenancy-manager/properties');
        }

        // Parse input values
        const parsedPaymentDay = parseInt(paymentDay);
        const parsedRentCollected = parseFloat(rentCollected) || 0;  
        const parsedRentDue = parseFloat(rentDue) || 0;              
        const parsedUtilitiesCollected = parseFloat(utilitiesCollected) || 0; 
        const parsedUtilitiesDue = parseFloat(utilitiesDue) || 0;              

        // Fetch the current property from the database
        const property = await Property.findById(req.params.id);
        if (!property) {
            req.flash('error', 'Property not found.');
            return res.redirect('/tenancy-manager/properties');
        }

        // Update the property with parsed and validated values
        await Property.findByIdAndUpdate(req.params.id, {
            name,
            address,
            propertyType: propertyType.trim(),
            paymentDay: parsedPaymentDay,
        });

        req.flash('success', 'Property updated successfully.');
        res.redirect('/tenancy-manager/properties');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Error updating property: ' + err.message);
        res.redirect('/tenancy-manager/properties');
    }
});


// Delete property
router.get('/tenancy-manager/property/delete/:id', isTenancyManager, async (req, res) => {
    try {
        await Property.findByIdAndDelete(req.params.id);
        req.flash('success', 'Property deleted successfully.');
        res.redirect('/tenancy-manager/properties');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Error deleting property.');
        res.redirect('/tenancy-manager/properties');
    }
});


// Edit Property Unit
router.post('/tenancy-manager/property/units/edit/:id', isTenancyManager, async (req, res) => {
    try {
        const { unitName, unitType, unitCount, unitPrice, description, vacantUnits, utilities, } = req.body;

        // Validate required fields
        if (!unitName || !unitType || unitCount === undefined || unitPrice === undefined || vacantUnits === undefined) {
            req.flash('error', 'All fields are required.');
            return res.redirect(`/tenancy-manager/property/units/${req.params.id}/edit`);
        }

        // Find the unit by ID and update it
        const updatedUnit = await PropertyUnit.findByIdAndUpdate(
            req.params.id,
            {
                unitName,
                unitType,
                unitCount,
                unitPrice,
                description,
                vacantUnits,
                utilities 
            },
            { new: true } 
        );

        // Check if the unit was found and updated
        if (!updatedUnit) {
            req.flash('error', 'Property unit not found.');
            return res.redirect('/tenancy-manager/property/units');
        }

        // Add a success message
        req.flash('success', 'Property unit updated successfully!');
        res.redirect('/tenancy-manager/property/units');
    } catch (error) {
        console.error('Error updating unit:', error);
        req.flash('error', 'Error updating unit: ' + error.message);
        res.redirect(`/tenancy-manager/property/units/${req.params.id}/edit`);
    }
});


// DELETE route for a property unit
router.post('/tenancy-manager/property/units/delete/:id', isTenancyManager, async (req, res) => {
    try {
        const unitId = req.params.id;
        
        
        const deletedUnit = await PropertyUnit.findByIdAndDelete(unitId);
        
        if (!deletedUnit) {
            req.flash('error', 'Property unit not found.');
            return res.redirect('/tenancy-manager/property/units');
        }

        req.flash('success', 'Property unit deleted successfully.');
        res.redirect('/tenancy-manager/property/units');
    } catch (err) {
        console.error('Error deleting unit:', err);
        req.flash('error', 'Error deleting property unit.');
        res.redirect('/tenancy-manager/property/units');
    }
});



// Export the router
module.exports = router;
