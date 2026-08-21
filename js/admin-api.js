class AdminAPI {
  constructor() {
    this.baseUrl = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1";
    this.tokenKey = "admin_token";
    this.tokenExpiryKey = "admin_token_expiry";
    this.origin = "https://www.querycrest.com";
    
    // Auto-clean expired tokens on init
    this._cleanExpiredToken();
  }

  /**
   * Get the stored token, if it exists and hasn't expired
   */
  _getToken() {
    const token = sessionStorage.getItem(this.tokenKey);
    const expiry = sessionStorage.getItem(this.tokenExpiryKey);

    if (!token || !expiry) return null;

    const now = Date.now();
    if (now > parseInt(expiry)) {
      this._cleanExpiredToken();
      return null;
    }

    return token;
  }

  /**
   * Store the token with expiry time (1 hour from now)
   */
  _setToken(token) {
    const expiryTime = Date.now() + 60 * 60 * 1000; // 1 hour
    sessionStorage.setItem(this.tokenKey, token);
    sessionStorage.setItem(this.tokenExpiryKey, expiryTime.toString());
  }

  /**
   * Clear the stored token
   */
  _cleanExpiredToken() {
    sessionStorage.removeItem(this.tokenKey);
    sessionStorage.removeItem(this.tokenExpiryKey);
  }

  /**
   * Make an authenticated fetch request
   * Automatically includes token if it exists
   */
  async _fetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const token = this._getToken();

    const headers = {
      "Content-Type": "application/json",
      "Origin": this.origin,
      ...options.headers,
    };

    // Include token if it exists (for authenticated endpoints)
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      // If token expired (401), clear it and suggest re-login
      if (response.status === 401) {
        this._cleanExpiredToken();
        throw {
          status: 401,
          message: "Session expired. Please log in again.",
          details: data,
        };
      }

      // If lockdown is active (503), surface it clearly
      if (response.status === 503) {
        throw {
          status: 503,
          message: data.error || "System is in emergency lockdown.",
          details: data,
        };
      }

      // Any other error
      if (!response.ok) {
        throw {
          status: response.status,
          message: data.error || "Request failed",
          details: data,
        };
      }

      return data;
    } catch (err) {
      // Network errors or JSON parse errors
      if (err.status === undefined) {
        throw {
          status: 0,
          message: err.message || "Network error",
          details: err,
        };
      }
      throw err;
    }
  }

  /**
   * Login object — handles two-step authentication
   */
  login = {
    /**
     * Step 1: Send verification code
     * Returns: { success: true, message: "...", nextStep: 2 }
     */
    step1: async (verificationCode) => {
      return await this._fetch("/auth", {
        method: "POST",
        body: JSON.stringify({
          step: "1",
          verification_code: verificationCode,
        }),
      });
    },

    /**
     * Step 2: Send admin password
     * Returns: { success: true, token: "...", message: "..." }
     * Token is automatically stored in sessionStorage
     */
    step2: async (adminPassword) => {
      const response = await this._fetch("/auth", {
        method: "POST",
        body: JSON.stringify({
          step: "2",
          admin_password: adminPassword,
        }),
      });

      if (response.token) {
        this._setToken(response.token);
      }

      return response;
    },

    /**
     * Check if user is currently authenticated
     */
    isAuthenticated: () => {
      return this._getToken() !== null;
    },

    /**
     * Logout — clear the stored token
     */
    logout: () => {
      this._cleanExpiredToken();
      return { success: true, message: "Logged out" };
    },
  };

  /**
   * Institutions object — CRUD operations on universities
   */
  institutions = {
    /**
     * Get all universities
     * Returns: { data: [...] }
     */
    getAll: async () => {
      return await this._fetch("/institutions", {
        method: "GET",
      });
    },

    /**
     * Get a single university by ID
     * Returns: { data: {...} }
     */
    getById: async (id) => {
      return await this._fetch(`/institutions/${id}`, {
        method: "GET",
      });
    },

    /**
     * Search universities by name
     * Returns: { data: [...] }
     */
    search: async (query) => {
      if (!query || !query.trim()) {
        throw {
          status: 400,
          message: "Search query is required",
        };
      }
      return await this._fetch(`/institutions/search?q=${encodeURIComponent(query)}`, {
        method: "GET",
      });
    },

    /**
     * Create a new university
     * Parameters: { name, type, opening_date?, closing_date? }
     * Returns: { data: {...}, message: "Institution created" }
     */
    create: async (institution) => {
      if (!institution.name || !institution.type) {
        throw {
          status: 400,
          message: "Name and type are required",
        };
      }
      return await this._fetch("/institutions", {
        method: "POST",
        body: JSON.stringify(institution),
      });
    },

    /**
     * Update an existing university
     * Parameters: id, { name, type, opening_date?, closing_date? }
     * Returns: { data: {...}, message: "Institution updated" }
     */
    update: async (id, institution) => {
      if (!institution.name || !institution.type) {
        throw {
          status: 400,
          message: "Name and type are required",
        };
      }
      return await this._fetch(`/institutions/${id}`, {
        method: "PUT",
        body: JSON.stringify(institution),
      });
    },

    /**
     * Delete a university
     * Returns: { message: "Institution deleted" }
     */
    delete: async (id) => {
      return await this._fetch(`/institutions/${id}`, {
        method: "DELETE",
      });
    },
  };

  /**
   * Bursaries object — CRUD operations on bursaries
   */
  bursaries = {
    /**
     * Get all bursaries
     * Returns: { data: [...] }
     */
    getAll: async () => {
      return await this._fetch("/bursaries", {
        method: "GET",
      });
    },

    /**
     * Get a single bursary by ID
     * Returns: { data: {...} }
     */
    getById: async (id) => {
      return await this._fetch(`/bursaries/${id}`, {
        method: "GET",
      });
    },

    /**
     * Search bursaries by name
     * Returns: { data: [...] }
     */
    search: async (query) => {
      if (!query || !query.trim()) {
        throw {
          status: 400,
          message: "Search query is required",
        };
      }
      return await this._fetch(`/bursaries/search?q=${encodeURIComponent(query)}`, {
        method: "GET",
      });
    },

    /**
     * Create a new bursary
     * Parameters: { name, type, opening_date?, closing_date?, status?, is_private? }
     * Returns: { data: {...}, message: "Bursary created" }
     */
    create: async (bursary) => {
      if (!bursary.name || !bursary.type) {
        throw {
          status: 400,
          message: "Name and type are required",
        };
      }
      return await this._fetch("/bursaries", {
        method: "POST",
        body: JSON.stringify(bursary),
      });
    },

    /**
     * Update an existing bursary
     * Parameters: id, { name, type, opening_date?, closing_date?, status?, is_private? }
     * Returns: { data: {...}, message: "Bursary updated" }
     */
    update: async (id, bursary) => {
      if (!bursary.name || !bursary.type) {
        throw {
          status: 400,
          message: "Name and type are required",
        };
      }
      return await this._fetch(`/bursaries/${id}`, {
        method: "PUT",
        body: JSON.stringify(bursary),
      });
    },

    /**
     * Delete a bursary
     * Returns: { message: "Bursary deleted" }
     */
    delete: async (id) => {
      return await this._fetch(`/bursaries/${id}`, {
        method: "DELETE",
      });
    },
  };

  /**
   * Lockdown object — emergency system shutdown
   */
  lockdown = {
    /**
     * Get current lockdown status
     * Returns: { is_active: boolean, expires_at?: string }
     */
    getStatus: async () => {
      return await this._fetch("/lockdown/status", {
        method: "GET",
      });
    },

    /**
     * Activate emergency lockdown
     * Parameters: { reason? }
     * Returns: { success: true, message: "...", data: {...} }
     */
    activate: async (reason = "Emergency lockdown activated") => {
      return await this._fetch("/lockdown/activate", {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },

    /**
     * Manually deactivate lockdown
     * Returns: { success: true, message: "..." }
     */
    deactivate: async () => {
      return await this._fetch("/lockdown/deactivate", {
        method: "POST",
      });
    },
  };
}

// Export as a singleton so the entire app uses one instance
const adminAPI = new AdminAPI();

// Also export the class for testing or advanced usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = { AdminAPI, adminAPI };
}