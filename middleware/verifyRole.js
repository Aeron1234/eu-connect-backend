export const verifyRole = (allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.verifiedUser.role;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: `Access Denied.`,
      });
    }
    next();
  };
};
