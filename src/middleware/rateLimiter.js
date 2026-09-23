const rateLimit = require('express-rate-limit');

// Standard API rate limiter (100 requests per 15 minutes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

// Stricter rate limiter for outbound calling initiation
const callInitiateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30, // max 30 outbound calls per 5 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Calling rate limit reached. Please wait before initiating more outbound calls.'
  }
});

module.exports = {
  apiLimiter,
  callInitiateLimiter,
};
