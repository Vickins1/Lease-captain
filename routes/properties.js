const express = require('express');
const router = express.Router();
const Property = require('../models/property');
const PropertyUnit = require('../models/unit');
const {  checkRole,isTenancyManager } = require('../middleware');

router.get('/tenancy-manager/properties', isTenancyManager, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // Aggregation pipeline to calculate rent, utilities, and tenant count for properties
        const properties = await Property.aggregate([
            {
                $match: { owner: req.user._id }
            },
            {
                // Lookup for units within the property
                $lookup: {
                    from: 'propertyunits',
                    localField: '_id',
                    foreignField: 'propertyId',
                    as: 'units'
                }
            },
            {
                // Lookup for tenants associated with each unit
                $lookup: {
                    from: 'tenants',
                    localField: 'units._id',
                    foreignField: 'unit',
                    as: 'tenants'
                }
            },
            {
                // Lookup for payments associated with each unit
                $lookup: {
                    from: 'payments',
                    localField: 'units._id',
                    foreignField: 'unitId',
                    as: 'payments'
                }
            },
            {
                $addFields: {
                    numberOfUnits: { $size: '$units' },
                    numberOfTenants: { $size: '$tenants' }, 
                    totalPaidRent: {
                        $sum: {
                            $map: {
                                input: '$payments',
                                as: 'p',
                                in: { $ifNull: ['$$p.amount', 0] }
                            }
                        }
                    },
                    totalPaidUtilities: {
                        $sum: {
                            $map: {
                                input: '$payments',
                                as: 'p',
                                in: { $ifNull: ['$$p.utilitiesAmount', 0] }
                            }
                        }
                    },
                    vacancies: {
                        $sum: {
                            $map: {
                                input: '$units',
                                as: 'unit',
                                in: {
                                    $cond: [{ $eq: ['$$unit.tenantId', null] }, 1, 0]
                                }
                            }
                        }
                    },
                    rentDue: {
                        $sum: {
                            $map: {
                                input: '$units',
                                as: 'unit',
                                in: {
                                    $cond: [
                                        { $ne: ['$$unit.tenantId', null] }, 
                                        { $subtract: ['$$unit.unitPrice', '$$unit.totalRentPaid'] }, 
                                        0
                                    ]
                                }
                            }
                        }
                    },
                    utilitiesDue: {
                        $sum: {
                            $map: {
                                input: '$units',
                                as: 'unit',
                                in: {
                                    $cond: [
                                        { $ne: ['$$unit.tenantId', null] }, 
                                        { $subtract: ['$$unit.utilitiesAmount', '$$unit.totalUtilitiesPaid'] }, 
                                        0
                                    ]
                                }
                            }
                        }
                    }
                }
            },
            {
                $addFields: {
                    status: {
                        $cond: { if: { $gt: ['$vacancies', 0] }, then: 'Vacancies available', else: 'Fully occupied' }
                    }
                }
            },
            { $skip: skip },
            { $limit: limit }
        ]);

        // Step 2: Update properties in the database with the calculated fields
        await Promise.all(
            properties.map(async (property) => {
                await Property.findByIdAndUpdate(
                    property._id,
                    {
                        rentCollected: property.totalPaidRent,
                        rentDue: property.rentDue,
                        utilitiesCollected: property.totalPaidUtilities,
                        utilitiesDue: property.utilitiesDue,
                        status: property.status,
                        numberOfTenants: property.numberOfTenants 
                    }
                );
            })
        );

        const totalProperties = await Property.countDocuments({ owner: req.user._id });
        const totalPages = Math.ceil(totalProperties / limit);

        // Render the properties list with the calculated values
        res.render('tenancyManager/properties', {
            properties,
            currentUser: req.user,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        console.error('Error fetching properties:', err);
        req.flash('error', 'Error fetching properties.');
        res.redirect('/tenancy-manager/dashboard');
    }
});


router.get('/tenancy-manager/property/units', isTenancyManager, async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error', 'User not authenticated.');
            return res.redirect('/login');
        }

        const units = await PropertyUnit.find()
            .populate({
                path: 'tenants',
                select: 'name'
            })
            .populate({
                path: 'propertyId',
                match: { owner: req.user._id },
                select: 'name'
            })
            .exec();

        const filteredUnits = units.filter(unit => unit.propertyId !== null);

        const unitsWithInfo = filteredUnits.map(unit => {
            const utilitiesAmount = unit.utilities 
                ? unit.utilities.reduce((total, utility) => total + (utility.amount || 0), 0)
                : 0;

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
                totalUtilitiesPaid: unit.totalUtilitiesPaid || 0,
                utilitiesDue: unit.utilitiesDue || 0,
                deposit: unit.deposit || 0
            };
        });

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
        const units = await PropertyUnit.find({ propertyId: propertyId }); // Adjusted to use propertyId

        // If no units found for the given property
        if (!units || units.length === 0) {
            return res.status(404).json({ message: 'No units found for this property' });
        }

        res.json(units);
    } catch (err) {
        console.error('Error fetching units:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Create Property Unit
router.post('/tenancy-manager/property/units', isTenancyManager, async (req, res) => {
    try {
        
        const { propertyId, unitType, unitCount, unitPrice, utilities, depositAmount } = req.body;

        // Validate required fields
        if (!propertyId || !unitType || !unitCount || !unitPrice || !utilities || depositAmount === undefined) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/tenancy-manager/property/units');
        }

        // Create a new PropertyUnit instance
        const newUnit = new PropertyUnit({
            propertyId,
            unitType,
            unitCount,
            unitPrice,
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
    const { name, address, paymentDay, propertyType } = req.body;

    // Input Validation
    if (!name || !address || !paymentDay || !propertyType) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/tenancy-manager/property');
    }


    try {
        // Create a new property object
        const newProperty = new Property({
            name,
            address,
            paymentDay, 
            propertyType,
            owner: req.user._id,
        });

        await newProperty.save();

        req.flash('success', 'Property added successfully!');
        res.redirect('/tenancy-manager/properties'); 
    } catch (err) {
        console.error(err);
        req.flash('error', 'Error adding property: ' + err.message);
        res.redirect('/tenancy-manager/properties'); 
    }
});


// Edit property
router.post('/tenancy-manager/property/edit/:id', isTenancyManager, async (req, res) => {
    try {
        const { name, address, propertyType, paymentDay} = req.body;

        // Input validation
        if (!name || !address || !propertyType || !paymentDay) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/tenancy-manager/properties');
        }

        // Parse input values
        const parsedPaymentDay = parseInt(paymentDay);             

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


// Delete Property by ID using POST
router.post('/tenancy-manager/property/delete/:id', isTenancyManager, async (req, res) => {
    try {
        const propertyId = req.params.id;
        const property = await Property.findByIdAndDelete(propertyId);

        if (!property) {
            req.flash('error', 'Property not found.');
            return res.status(404).redirect('/tenancy-manager/properties');
        }

        req.flash('success', 'Property deleted successfully.');
        res.redirect('/tenancy-manager/properties');
    } catch (error) {
        console.error(error);
        req.flash('error', 'An error occurred while deleting the property.');
        res.redirect('/tenancy-manager/properties');
    }
});



// Edit Property Unit
router.post('/tenancy-manager/property/units/edit/:id', isTenancyManager, async (req, res) => {
    try {
        // Extract data from the request body
        const { unitType, unitCount, unitPrice, utilities, deposit } = req.body;

        // Validate required fields
        if (!unitType || unitCount === undefined || unitPrice === undefined || deposit === undefined) {
            req.flash('error', 'All fields are required.');
            return res.redirect(`/tenancy-manager/property/units/${req.params.id}/edit`);
        }

        // Find the unit by ID and update it
        const updatedUnit = await PropertyUnit.findByIdAndUpdate(
            req.params.id, // Use req.params.id for the URL parameter ID
            {
                unitType,
                unitCount,
                unitPrice,
                utilities,  // Assuming utilities is an array of objects
                deposit
            },
            { new: true }  // Return the updated unit after modification
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
