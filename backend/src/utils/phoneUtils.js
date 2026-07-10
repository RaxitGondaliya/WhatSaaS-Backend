/**
 * Normalizes a phone number for duplicate prevention checks.
 * Strips all non-digit characters and returns the last 10 digits.
 * 
 * @param {string} phone 
 * @returns {string} Normalized phone number
 */
const normalizePhone = (phone) => {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

module.exports = {
  normalizePhone,
};
