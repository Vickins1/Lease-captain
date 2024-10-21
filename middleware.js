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

// Middleware to check if the user has a specific role
function checkRole(role) {
    return async (req, res, next) => {
        if (!req.isAuthenticated() || !req.user) {
            req.flash('error', 'You need to log in to access this page.');
            return res.redirect(LOGIN_REDIRECT);
        }
        try {
            // Fetch the user and populate their roles
            const user = await User.findById(req.user._id).populate('roles');

            // Ensure the user and roles exist
            if (user && user.roles && user.roles.length > 0) {
                const hasRole = user.roles.some(userRole => userRole.name === role);
                
                if (hasRole) {
                    return next();
                } else {
                    req.flash('error', 'Forbidden: You do not have the required role to access this resource.');
                    return res.redirect('/tenancy-manager/dashboard');
                }
            } else {
                req.flash('error', 'Forbidden: You do not have the required role to access this resource.');
                return res.redirect('/tenancy-manager/dashboard');
            }
        } catch (error) {
            console.error('Error fetching user for role check:', error);
            req.flash('error', 'Internal server error. Please try again later.');
            return res.redirect('/tenancy-manager/dashboard'); 
        }
    };
}




// Export the middleware functions
module.exports = {
    isAuthenticated,
    isTenant,
    isTenancyManager,
    checkRole, 
};
