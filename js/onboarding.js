// ============================================================
// QUERYCREST ONBOARDING SYSTEM - WITH BACKEND API
// ============================================================

class OnboardingSystem {
    constructor(options = {}) {
        this.dashboardType = options.dashboardType || 'admin';
        this.apiBase = options.apiBase || 'https://xkjsydeavdcarwkthppz.supabase.co/functions/v1';
        
        // Steps will be loaded from API
        this.steps = [];
        this.currentStep = 0;
        this.totalSteps = 0;
        this.completed = false;
        this.isActive = false;
        this.hasShownCompletion = false;
        this.isLoading = true;
        
        this.overlayElement = null;
        this.bubbleElement = null;
        this.completionElement = null;
        
        this.resizeTimeout = null;
        this.retryTimeout = null;
        
        this.init = this.init.bind(this);
        this.loadSteps = this.loadSteps.bind(this);
        this.showStep = this.showStep.bind(this);
        this.nextStep = this.nextStep.bind(this);
        this.previousStep = this.previousStep.bind(this);
        this.skipOnboarding = this.skipOnboarding.bind(this);
        this.completeOnboarding = this.completeOnboarding.bind(this);
        this.calculatePosition = this.calculatePosition.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.handleKeyPress = this.handleKeyPress.bind(this);
        this.removeHighlight = this.removeHighlight.bind(this);
        this.destroy = this.destroy.bind(this);
        
        window.onboardingSystem = this;
    }

    // ============================================================
    // TOKEN & AUTH
    // ============================================================

    getToken() {
        return sessionStorage.getItem('admin_token') || localStorage.getItem('admin_token');
    }

    // ============================================================
    // API METHODS
    // ============================================================

    async getOnboardingStatus(token) {
        const response = await fetch(`${this.apiBase}/onboarding-status?dashboard=${this.dashboardType}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }

    async loadSteps(token) {
        const response = await fetch(`${this.apiBase}/onboarding-steps?dashboard=${this.dashboardType}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        this.steps = data.steps || [];
        this.totalSteps = this.steps.length;
        console.log(`📚 Loaded ${this.totalSteps} steps from API`);
    }

    async updateProgress(step) {
        const token = this.getToken();
        if (!token) return;

        try {
            const response = await fetch(`${this.apiBase}/onboarding-progress`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    step: step, 
                    dashboardType: this.dashboardType 
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            console.log(`📝 Progress updated: step ${step}`);
        } catch (error) {
            console.warn('⚠️ Failed to update progress:', error);
        }
    }

    async completeOnboardingAPI() {
        const token = this.getToken();
        if (!token) return;

        try {
            const response = await fetch(`${this.apiBase}/onboarding-complete`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    dashboardType: this.dashboardType 
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            console.log('✅ Onboarding marked as completed in database');
        } catch (error) {
            console.warn('⚠️ Failed to complete onboarding in database:', error);
        }
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    async init() {
        console.log('🎯 Onboarding System Initializing...');

        const token = this.getToken();
        if (!token) {
            console.log('🔴 No token found, skipping onboarding');
            this.isLoading = false;
            return;
        }

        try {
            // 1. Get onboarding status from API
            const status = await this.getOnboardingStatus(token);
            console.log('📊 Onboarding Status:', status);

            if (status.completed) {
                console.log('✅ Onboarding already completed');
                this.isLoading = false;
                return;
            }

            // 2. Load steps from API
            await this.loadSteps(token);

            if (this.steps.length === 0) {
                console.warn('⚠️ No onboarding steps found');
                this.isLoading = false;
                return;
            }

            // 3. Set current step
            this.currentStep = status.currentStep || 0;
            this.completed = status.completed || false;
            this.isActive = true;
            this.isLoading = false;

            console.log(`🔄 Onboarding starting at step ${this.currentStep + 1}/${this.totalSteps}`);

            // 4. Create UI
            this.createUI();

            // 5. Show current step
            const isMobile = window.innerWidth < 768;
            const delay = isMobile ? 1500 : 500;

            setTimeout(() => {
                this.showStep(this.currentStep);
            }, delay);

        } catch (error) {
            console.error('❌ Failed to initialize onboarding:', error);
            this.isLoading = false;
            
            // Fallback: Use default steps if API fails
            this.steps = this.getDefaultSteps();
            this.totalSteps = this.steps.length;
            this.isActive = true;
            this.createUI();
            setTimeout(() => {
                this.showStep(0);
            }, 500);
        }
    }

    // ============================================================
    // DEFAULT STEPS (Fallback)
    // ============================================================

    getDefaultSteps() {
        return [
            {
                id: 1,
                stepOrder: 0,
                targetElement: '.deadlines',
                title: '👋 Welcome to QueryCrest!',
                content: 'Welcome to your Admin Dashboard! This quick tour will show you how to manage deadlines for universities and bursaries.',
                placement: 'center'
            },
            {
                id: 2,
                stepOrder: 1,
                targetElement: '.sb-nav',
                title: '📊 Navigate Your Dashboard',
                content: 'Use these three main sections: Dashboard (home), Search (find institutions), and Add Data (manage records).',
                placement: 'right'
            },
            {
                id: 3,
                stepOrder: 2,
                targetElement: '.search-container',
                title: '🔍 Quick Filter',
                content: 'Use this search bar to filter universities and bursaries instantly. Start typing to see matching results.',
                placement: 'bottom'
            },
            {
                id: 4,
                stepOrder: 3,
                targetElement: '.status-badge',
                title: '📌 Track Deadlines',
                content: 'Each record shows its status: Open (available), Closed (passed), or Pending (coming soon).',
                placement: 'top'
            },
            {
                id: 5,
                stepOrder: 4,
                targetElement: '.approach',
                title: '⏰ Approaching Deadlines',
                content: 'Keep an eye on this section to see which deadlines are coming up soon.',
                placement: 'bottom'
            },
            {
                id: 6,
                stepOrder: 5,
                targetElement: '[data-p="search"]',
                title: '🔎 Advanced Search',
                content: 'The Search tab lets you find institutions across all your data with more control.',
                placement: 'right'
            },
            {
                id: 7,
                stepOrder: 6,
                targetElement: '[data-p="add-data"]',
                title: '✏️ Manage Records',
                content: 'Add new records, update existing ones, or delete outdated entries all from one place.',
                placement: 'right'
            },
            {
                id: 8,
                stepOrder: 7,
                targetElement: '.audit-container',
                title: '📝 Audit Log',
                content: 'Every action is tracked here. You can always see what changes have been made and when.',
                placement: 'bottom'
            },
            {
                id: 9,
                stepOrder: 8,
                targetElement: '.btn-primary',
                title: '🎉 You\'re Ready!',
                content: 'You now know the essentials of the QueryCrest Admin Dashboard. Happy managing!',
                placement: 'center'
            }
        ];
    }

    // ============================================================
    // UI CREATION
    // ============================================================

    createUI() {
        // Create overlay
        this.overlayElement = document.createElement('div');
        this.overlayElement.id = 'onboarding-overlay';
        this.overlayElement.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            pointer-events: none;
        `;
        document.body.appendChild(this.overlayElement);

        // Create bubble
        this.bubbleElement = document.createElement('div');
        this.bubbleElement.id = 'onboarding-bubble';
        this.bubbleElement.style.cssText = `
            position: fixed;
            z-index: 9999;
            background: white;
            border-radius: 12px;
            padding: 20px;
            max-width: 380px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
            display: none;
            pointer-events: all;
            font-family: 'Poppins', sans-serif;
        `;
        document.body.appendChild(this.bubbleElement);

        // Create completion modal
        this.completionElement = document.createElement('div');
        this.completionElement.id = 'onboarding-completion';
        this.completionElement.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            padding: 20px;
        `;
        document.body.appendChild(this.completionElement);

        document.addEventListener('keydown', this.handleKeyPress);
        window.addEventListener('resize', this.handleResize);

        console.log('🎨 Onboarding UI created');
    }

    removeUI() {
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        if (this.bubbleElement) {
            this.bubbleElement.remove();
            this.bubbleElement = null;
        }
        this.removeHighlight();
        document.removeEventListener('keydown', this.handleKeyPress);
        window.removeEventListener('resize', this.handleResize);
        console.log('🗑️ Onboarding UI removed');
    }

    // ============================================================
    // TARGET FINDING & POSITIONING
    // ============================================================

    findTarget(selector) {
        if (!selector || typeof selector !== 'string') {
            console.warn('⚠️ Invalid selector:', selector);
            return null;
        }

        selector = selector.trim();
        let element = document.querySelector(selector);
        if (element) return element;

        const variations = [
            selector.toLowerCase(),
            selector.toUpperCase(),
            selector.replace(/-/g, '_'),
            selector.replace(/_/g, '-'),
            selector.replace(/[\[\]"]/g, '')
        ];

        for (const variation of variations) {
            try {
                element = document.querySelector(variation);
                if (element) return element;
            } catch (e) {}
        }

        if (selector.includes('data-p')) {
            const allElements = document.querySelectorAll('[data-p]');
            for (const el of allElements) {
                const dataValue = el.getAttribute('data-p');
                if (dataValue && selector.includes(dataValue)) {
                    return el;
                }
            }
        }

        console.warn(`⚠️ Target not found: ${selector}`);
        return null;
    }

    removeHighlight() {
        const highlighted = document.getElementById('onboarding-highlight');
        if (highlighted) {
            highlighted.removeAttribute('id');
        }
    }

    calculatePosition(target, placement) {
        const rect = target.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const isMobile = viewportWidth < 768;
        
        const bubbleWidth = this.bubbleElement?.offsetWidth || 340;
        const bubbleHeight = this.bubbleElement?.offsetHeight || 220;
        const gap = 16;
        
        let x, y;

        if (isMobile) {
            const mobileWidth = Math.min(bubbleWidth, viewportWidth - 32);
            x = (viewportWidth - mobileWidth) / 2;
            y = viewportHeight - bubbleHeight - 80;
            if (y < 10) y = 10;
            return { x, y };
        }

        const bw = Math.min(bubbleWidth, 380);
        const bh = Math.min(bubbleHeight, 250);

        switch(placement) {
            case 'bottom':
                x = rect.left + rect.width/2 - bw/2;
                y = rect.bottom + gap;
                break;
            case 'top':
                x = rect.left + rect.width/2 - bw/2;
                y = rect.top - bh - gap;
                break;
            case 'left':
                x = rect.left - bw - gap;
                y = rect.top + rect.height/2 - bh/2;
                break;
            case 'right':
                x = rect.right + gap;
                y = rect.top + rect.height/2 - bh/2;
                break;
            case 'center':
            default:
                x = (viewportWidth - bw) / 2;
                y = (viewportHeight - bh) / 2;
                break;
        }

        x = Math.max(10, Math.min(x, viewportWidth - bw - 10));
        y = Math.max(10, Math.min(y, viewportHeight - bh - 10));

        return { x, y };
    }

    getArrowStyle(placement) {
        const styles = {
            'bottom': 'bottom: -10px; left: 50%; transform: translateX(-50%);',
            'top': 'top: -10px; left: 50%; transform: translateX(-50%) rotate(180deg);',
            'left': 'left: -10px; top: 50%; transform: translateY(-50%) rotate(90deg);',
            'right': 'right: -10px; top: 50%; transform: translateY(-50%) rotate(-90deg);'
        };
        return styles[placement] || styles['bottom'];
    }

    // ============================================================
    // STEP DISPLAY
    // ============================================================

    showStep(index) {
        console.log(`🔍 Showing step ${index}`);

        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        if (index < 0 || index >= this.totalSteps) {
            this.completeOnboarding();
            return;
        }

        const step = this.steps[index];
        if (!step) {
            console.error(`❌ Step ${index} not found`);
            return;
        }

        if (!step.targetElement) {
            console.error(`❌ Step ${index} has no targetElement!`);
            this.nextStep();
            return;
        }

        this.currentStep = index;

        const target = this.findTarget(step.targetElement);
        if (!target) {
            console.warn(`⚠️ Target not found: ${step.targetElement}, retrying...`);
            this.retryTimeout = setTimeout(() => {
                this.showStep(index);
            }, 800);
            return;
        }

        this.removeHighlight();
        target.setAttribute('id', 'onboarding-highlight');

        try {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {}

        this.bubbleElement.style.display = 'block';

        const isLastStep = index === this.totalSteps - 1;
        const isFirstStep = index === 0;
        const isMobile = window.innerWidth < 768;
        const showArrow = !isMobile && step.placement !== 'center';

        const position = this.calculatePosition(target, step.placement || 'bottom');
        
        if (isMobile) {
            this.bubbleElement.style.maxWidth = (window.innerWidth - 32) + 'px';
            this.bubbleElement.style.left = '50%';
            this.bubbleElement.style.transform = 'translateX(-50%)';
            this.bubbleElement.style.top = position.y + 'px';
            this.bubbleElement.style.bottom = 'auto';
            this.bubbleElement.style.right = 'auto';
        } else {
            this.bubbleElement.style.left = position.x + 'px';
            this.bubbleElement.style.top = position.y + 'px';
            this.bubbleElement.style.transform = 'none';
            this.bubbleElement.style.maxWidth = '380px';
        }

        let buttonText = 'Next →';
        let buttonClass = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';
        let buttonAction = 'window.onboardingSystem.nextStep()';

        if (isLastStep) {
            buttonText = '🎉 Finish';
            buttonClass = 'background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);';
            buttonAction = 'window.onboardingSystem.completeOnboarding()';
        }

        this.bubbleElement.innerHTML = `
            <div style="position: relative;">
                ${showArrow ? `<div style="
                    position: absolute;
                    width: 0;
                    height: 0;
                    border-left: 10px solid transparent;
                    border-right: 10px solid transparent;
                    border-bottom: 10px solid white;
                    ${this.getArrowStyle(step.placement)}
                "></div>` : ''}
                <h3 style="color: #1a202c; font-size: ${isMobile ? '17px' : '18px'}; font-weight: 600; margin: 0 0 8px 0;">
                    ${step.title}
                </h3>
                <p style="color: #4a5568; font-size: ${isMobile ? '14px' : '15px'}; line-height: 1.6; margin: 0 0 16px 0;">
                    ${step.content}
                </p>
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <span style="color: #a0aec0; font-size: ${isMobile ? '13px' : '13px'}; font-weight: 500;">
                        ${index + 1} / ${this.totalSteps}
                    </span>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button onclick="window.onboardingSystem.skipOnboarding()" style="
                            padding: ${isMobile ? '10px 16px' : '8px 12px'};
                            border: none;
                            background: none;
                            color: #a0aec0;
                            font-size: ${isMobile ? '14px' : '13px'};
                            font-weight: 600;
                            cursor: pointer;
                            ${isMobile ? 'min-height: 44px;' : ''}
                        ">Skip</button>
                        ${!isFirstStep ? `<button onclick="window.onboardingSystem.previousStep()" style="
                            padding: ${isMobile ? '10px 18px' : '8px 16px'};
                            border: none;
                            border-radius: 6px;
                            background: #e2e8f0;
                            color: #4a5568;
                            font-size: ${isMobile ? '14px' : '13px'};
                            font-weight: 600;
                            cursor: pointer;
                            ${isMobile ? 'min-height: 44px;' : ''}
                        ">Back</button>` : ''}
                        <button onclick="${buttonAction}" style="
                            padding: ${isMobile ? '10px 20px' : '8px 16px'};
                            border: none;
                            border-radius: 6px;
                            ${buttonClass}
                            color: white;
                            font-size: ${isMobile ? '15px' : '13px'};
                            font-weight: 600;
                            cursor: pointer;
                            ${isMobile ? 'min-height: 44px; min-width: 80px;' : ''}
                        ">
                            ${buttonText}
                        </button>
                    </div>
                </div>
            </div>
        `;

        console.log(`📍 Showing step ${index + 1}/${this.totalSteps}: ${step.title}`);
        
        // Update progress in database
        this.updateProgress(index);
    }

    // ============================================================
    // NAVIGATION
    // ============================================================

    nextStep() {
        if (this.currentStep < this.totalSteps - 1) {
            this.showStep(this.currentStep + 1);
        } else {
            this.completeOnboarding();
        }
    }

    previousStep() {
        if (this.currentStep > 0) {
            this.showStep(this.currentStep - 1);
        }
    }

    skipOnboarding() {
        if (confirm('Skip the tour? You can always restart it later.')) {
            console.log('⏭️ User skipped onboarding');
            
            if (this.bubbleElement) {
                this.bubbleElement.style.display = 'none';
            }
            if (this.overlayElement) {
                this.overlayElement.remove();
                this.overlayElement = null;
            }
            this.removeHighlight();
            
            this.completed = true;
            this.isActive = false;
            
            // Mark as completed in database
            this.completeOnboardingAPI().then(() => {
                this.showCompletion();
            });
        }
    }

    completeOnboarding() {
        console.log('🎉 Completing onboarding...');
        
        if (this.bubbleElement) {
            this.bubbleElement.style.display = 'none';
        }
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        this.removeHighlight();
        
        this.completed = true;
        this.isActive = false;
        
        // Mark as completed in database
        this.completeOnboardingAPI().then(() => {
            this.showCompletion();
        });
    }

    // ============================================================
    // COMPLETION
    // ============================================================

    showCompletion() {
        console.log('🎊 Showing completion modal');
        
        let modal = document.getElementById('onboarding-completion');
        
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'onboarding-completion';
            modal.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 9999;
                display: none;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                padding: 20px;
            `;
            document.body.appendChild(modal);
            this.completionElement = modal;
        }

        const isMobile = window.innerWidth < 768;

        modal.style.display = 'flex';
        modal.innerHTML = `
            <div style="
                background: white;
                border-radius: ${isMobile ? '16px' : '20px'};
                padding: ${isMobile ? '32px 24px' : '48px 40px'};
                max-width: ${isMobile ? '100%' : '500px'};
                width: ${isMobile ? 'calc(100% - 32px)' : '100%'};
                text-align: center;
                box-shadow: 0 24px 60px rgba(0,0,0,0.3);
                animation: bubbleSlideIn 0.5s ease;
                margin: 0 16px;
            ">
                <div style="font-size: ${isMobile ? '48px' : '64px'}; margin-bottom: 16px;">🎉</div>
                <h2 style="
                    color: #1a202c; 
                    font-size: ${isMobile ? '24px' : '28px'}; 
                    font-weight: 700; 
                    margin-bottom: 12px; 
                    font-family: 'Poppins', sans-serif;
                ">
                    You're All Set!
                </h2>
                <p style="
                    color: #4a5568; 
                    font-size: ${isMobile ? '15px' : '16px'}; 
                    line-height: 1.7; 
                    margin-bottom: 24px; 
                    font-family: 'Poppins', sans-serif;
                ">
                    You've successfully completed the QueryCrest Admin Dashboard tour!<br><br>
                    You now know how to navigate, search, and manage deadlines.<br>
                    <strong>Welcome aboard!</strong>
                </p>
                <button onclick="window.onboardingSystem.destroy()" style="
                    padding: ${isMobile ? '14px 24px' : '14px 40px'};
                    border: none;
                    border-radius: 12px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    font-size: ${isMobile ? '16px' : '16px'};
                    font-weight: 600;
                    cursor: pointer;
                    font-family: 'Poppins', sans-serif;
                    box-shadow: 0 4px 16px rgba(102,126,234,0.3);
                    ${isMobile ? 'width: 100%;' : ''}
                ">
                    🚀 Get Started
                </button>
            </div>
        `;
    }

    destroy() {
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        if (this.bubbleElement) {
            this.bubbleElement.remove();
            this.bubbleElement = null;
        }
        if (this.completionElement) {
            this.completionElement.remove();
            this.completionElement = null;
        }
        this.removeHighlight();
        document.removeEventListener('keydown', this.handleKeyPress);
        window.removeEventListener('resize', this.handleResize);
        
        this.isActive = false;
        if (window.onboardingSystem === this) {
            window.onboardingSystem = null;
        }
        console.log('🧹 Onboarding system destroyed');
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    handleResize() {
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            if (this.isActive && this.steps[this.currentStep]) {
                const step = this.steps[this.currentStep];
                const target = this.findTarget(step.targetElement);
                if (target && this.bubbleElement) {
                    const position = this.calculatePosition(target, step.placement || 'bottom');
                    
                    const isMobile = window.innerWidth < 768;
                    if (isMobile) {
                        this.bubbleElement.style.left = '50%';
                        this.bubbleElement.style.transform = 'translateX(-50%)';
                        this.bubbleElement.style.top = position.y + 'px';
                    } else {
                        this.bubbleElement.style.left = position.x + 'px';
                        this.bubbleElement.style.top = position.y + 'px';
                        this.bubbleElement.style.transform = 'none';
                    }
                }
            }
        }, 200);
    }

    handleKeyPress(e) {
        if (!this.isActive || this.completed) return;
        if (['input', 'textarea', 'select'].includes(e.target.tagName.toLowerCase())) return;

        switch(e.key) {
            case 'Escape': this.skipOnboarding(); break;
            case 'ArrowRight':
            case 'ArrowDown':
            case ' ':
                e.preventDefault();
                this.nextStep();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                this.previousStep();
                break;
            case 'Enter':
                e.preventDefault();
                this.nextStep();
                break;
        }
    }
}

// ============================================================
// AUTO-INITIALIZE
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        const system = new OnboardingSystem({
            dashboardType: 'admin',
            apiBase: 'https://xkjsydeavdcarwkthppz.supabase.co/functions/v1'
        });
        system.init();
    }, 1000);
});