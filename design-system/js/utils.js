/* Utility functions for design system */

// Get color by name
function getColor(colorName) {
    const colors = {
        'primary': 'rgb(59, 130, 246)',
        'success': 'rgb(16, 185, 129)',
        'danger': 'rgb(239, 68, 68)',
        'warning': 'rgb(245, 158, 11)',
        'info': 'rgb(14, 165, 233)',
    };
    return colors[colorName] || colorName;
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Fetch with error handling
async function apiCall(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        showToast(error.message, 'danger');
        throw error;
    }
}

// Format date
function formatDate(date) {
    return new Date(date).toLocaleDateString('sv-SE');
}

// Format currency
function formatCurrency(amount, currency = 'SEK') {
    return new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: currency
    }).format(amount);
}
