const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the Property schema
const PropertySchema = new Schema({
    name: {
        type: String,
        required: [true, 'Property name is required'],
        trim: true
    },
    address: {
        type: String,
        required: [true, 'Address is required'],
        trim: true
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Owner is required']
    },
    units: [{
        type: Schema.Types.ObjectId,
        ref: 'PropertyUnit'
    }],
    propertyType: {
        type: String,
        required: [true, 'Property type is required'],
        trim: true
    },
    tenants: [{ 
        type: Schema.Types.ObjectId,
        ref: 'Tenant' 
    }],
    paymentDay: {
        type: Number,
        required: [true, 'Payment day is required'],
        min: 1,
        max: 31
    },
    rentCollected: {
        type: Number,
        default: 0,
        min: 0 
    },
    rentDue: {
        type: Number,
        default: 0,
        min: 0
    },
    utilitiesCollected: {
        type: Number,
        default: 0,
        min: 0
    },
    utilitiesDue: {
        type: Number,
        default: 0,
        min: 0
    },
    numberOfTenants: {
        type: Number,
        default: 0
    },

    vacant: { 
        type: Number,
        default: 0
    }
}, { timestamps: true });

PropertySchema.methods.updateRentUtilitiesAndTenants = async function() {
    try {
        // Populate the property with its units and tenants
        const populatedProperty = await this.populate({
            path: 'units',
            populate: {
                path: 'tenants',
                select: '_id'
            }
        });

        // Query the Payment model to fetch all payments related to the property's units
        const payments = await mongoose.model('Payment').find({
            propertyId: this._id
        });

        // Calculate total rent and utilities collected from the payments
        const totalRentCollected = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
        const totalUtilitiesCollected = payments.reduce((sum, payment) => sum + (payment.utilitiesAmount || 0), 0);

        // Set the collected amounts in the property
        this.rentCollected = totalRentCollected;
        this.utilitiesCollected = totalUtilitiesCollected;

        // Calculate rent and utilities due based on the property units' rent/utility data
        const totalRentDue = populatedProperty.units.reduce((sum, unit) => sum + (unit.rentDue || 0), 0);
        const totalUtilitiesDue = populatedProperty.units.reduce((sum, unit) => sum + (unit.utilitiesDue || 0), 0);

        // Set the rent and utilities due in the property
        this.rentDue = totalRentDue;
        this.utilitiesDue = totalUtilitiesDue;

        // Calculate the total number of tenants
        const numberOfTenants = populatedProperty.units.reduce((total, unit) => {
            return total + (unit.tenants ? unit.tenants.length : 0);
        }, 0);

        // Set the number of tenants in the property
        this.numberOfTenants = numberOfTenants;

        // Calculate the number of vacant units
        const numberOfVacantUnits = populatedProperty.units.reduce((total, unit) => {
            return total + (unit.tenants.length === 0 ? 1 : 0); // Increment if the unit has no tenants
        }, 0);

        // Set the number of vacant units in the property
        this.vacant = numberOfVacantUnits;

        // Determine the status based on the number of vacant units
        if (numberOfVacantUnits === 0) {
            this.status = 'Fully Occupied';
        } else if (numberOfVacantUnits === populatedProperty.units.length) {
            this.status = 'Vacant';
        } else {
            this.status = 'Partially Occupied';
        }

        // Save the updated property
        await this.save();

        return this;
    } catch (error) {
        console.error('Error updating property rent, utilities, tenants, and status:', error);
        throw error;
    }
};



module.exports = mongoose.models.Property || mongoose.model('Property', PropertySchema);
