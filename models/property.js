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
        const Payment = mongoose.model('Payment');
        const Tenant = mongoose.model('Tenant');

        // Populate units and fetch tenants directly
        await this.populate('units');
        const tenants = await Tenant.find({ property: this._id });

        // Fetch payments for this property
        const payments = await Payment.find({ property: this._id });

        // Calculate collected amounts
        this.rentCollected = payments.reduce((sum, p) => sum + (p.rentPaid || 0), 0);
        this.utilitiesCollected = payments.reduce((sum, p) => sum + (p.utilityPaid || 0), 0);

        // Calculate due amounts from tenants
        this.rentDue = tenants.reduce((sum, t) => sum + (t.rentDue || 0), 0);
        this.utilitiesDue = tenants.reduce((sum, t) => sum + (t.utilityDue || 0), 0);

        // Update tenant and vacancy counts
        const unitTenants = this.units.reduce((total, unit) => total + (unit.tenants?.length || 0), 0);
        this.numberOfTenants = unitTenants;
        this.vacant = this.units.length - this.units.filter(u => u.tenants?.length > 0).length;

        // Set status
        this.status = this.vacant === 0 ? 'Fully Occupied' : 
                      this.vacant === this.units.length ? 'Vacant' : 'Partially Occupied';

        await this.save();
        return this;
    } catch (error) {
        console.error('Error updating property:', error);
        throw error;
    }
};

module.exports = mongoose.models.Property || mongoose.model('Property', PropertySchema);
