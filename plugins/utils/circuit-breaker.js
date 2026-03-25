class CircuitBreakerError extends Error {
  constructor(message) {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

class CircuitBreaker {
  constructor(action, options = {}) {
    this.action = action;
    this.failureThreshold = options.failureThreshold || 3;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 10000;
    
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = Date.now();
  }

  async fire(...args) {
    if (this.state === "OPEN") {
      if (this.nextAttempt <= Date.now()) {
        this.state = "HALF_OPEN";
      } else {
        throw new CircuitBreakerError("Circuit is currently OPEN");
      }
    }

    try {
      const response = await this.action(...args);
      return this.onSuccess(response);
    } catch (error) {
      return this.onFailure(error);
    }
  }

  onSuccess(response) {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.successes = 0;
        this.state = "CLOSED";
      }
    }
    return response;
  }

  onFailure(error) {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.timeout;
    }
    throw error;
  }
}

/**
 * Exponential backoff with jitter retry strategy
 */
async function withRetry(operation, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.baseDelay || 1000;
  const maxDelay = options.maxDelay || 10000;
  
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 200 - 100; // +/- 100ms jitter
      const waitTime = Math.max(0, delay + jitter);
      
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

module.exports = {
  CircuitBreaker,
  withRetry,
  CircuitBreakerError
};
