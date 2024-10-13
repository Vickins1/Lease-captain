const User = require('./models/user'); 

// Redirect paths
const LOGIN_REDIRECT = '/login';
const TENANT_LOGIN_REDIRECT = '/tenantPortal/login';

// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();  
    }
    req.flash('error', 'You need to log in to access this page.');
    return res.redirect(LOGIN_REDIRECT);
}

// Middleware to check if the authenticated user is a tenant
function isTenant(req, res, next) {
    if (!req.isAuthenticated()) {
        req.flash('error', 'You need to log in as a tenant to access this page.');
        return res.redirect(TENANT_LOGIN_REDIRECT);
    }
    if (req.user.role === 'tenant') {  
        return next();  
    }
    req.flash('error', 'You do not have permission to access this page.');  
    return res.redirect('/tenantPortal/dashboard'); 
}

// Middleware to allow tenancy managers access 
function isTenancyManager(req, res, next) {
    if (req.isAuthenticated()) { 
        return next();  
    }
    req.flash('error', 'You need to log in to access this page.'); 
    return res.redirect(LOGIN_REDIRECT);
}

// Middleware to check if the user has a specific permission
function checkPermission(permission) {
    return async (req, res, next) => {
        if (!req.isAuthenticated() || !req.user) {
            req.flash('error', 'You need to log in to access this page.');
            return res.redirect(LOGIN_REDIRECT);
        }

        try {
            const user = await User.findById(req.user._id);
            if (user && user.permissions.includes(permission)) {
                return next();
            } else {
                req.flash('error', 'Forbidden: You do not have permission to access this resource.');
                return res.status(403).send('Forbidden');
            }
        } catch (error) {
            console.error('Error fetching user for permission check:', error);
            req.flash('error', 'Internal server error. Please try again later.');
            return res.status(500).send('Internal Server Error');
        }
    };
}

// Export the middleware functions
module.exports = {
    isAuthenticated,
    isTenant,
    isTenancyManager,
    checkPermission, 
};
