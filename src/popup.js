const ext = globalThis.browser || globalThis.chrome;

document.addEventListener('DOMContentLoaded', async () => {
    const manifest = ext.runtime.getManifest();
    document.title = manifest.name;
    document.getElementById('extension-title').textContent = manifest.name;
    document.getElementById('version-tag').textContent = 'V ' + manifest.version;

    const openSettingsBtn = document.getElementById('open-settings-btn');
    const rulesList = document.getElementById('active-rules-list');
    const emptyState = document.getElementById('no-rules-state');
    const quickAddBtn = document.getElementById('quick-add-btn');
    const warningBanner = document.getElementById('no-access-warning');
    const addRuleLink = document.getElementById('add-rule-link');

    openSettingsBtn.addEventListener('click', () => {
        ext.runtime.openOptionsPage();
    });

    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tab ? tab.url : '';

    if (isRestrictedUrl(tabUrl)) {
        warningBanner.classList.remove('hidden');
        emptyState.classList.add('hidden');
        rulesList.classList.add('hidden');
        quickAddBtn.classList.add('hidden');
        return;
    }

    const { rules: storedRules } = await ext.storage.local.get(['rules']);
    const allRules = storedRules || [];
    const matchingRules = allRules.filter(r => isMatch(tabUrl, r.urlPattern));
    if (matchingRules.length === 0) {
        emptyState.classList.remove('hidden');
        rulesList.classList.add('hidden');
        quickAddBtn.classList.add('hidden');
    } else {
        renderRules(matchingRules, allRules);
        emptyState.classList.add('hidden');
        rulesList.classList.remove('hidden');
        quickAddBtn.classList.remove('hidden');
    }

    async function addNewRuleForSite() {
        try {
            const urlObj = new URL(tabUrl);
            const domainPattern = `${urlObj.origin}/*`;
            const { rules: current } = await ext.storage.local.get(['rules']);
            const rules = current || [];
            const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
            const newRule = {
                id: newId,
                name: urlObj.hostname,
                urlPattern: domainPattern,
                js: '',
                jsLanguage: 'js',
                css: '',
                libs: [],
                enabled: true,
                runAt: 'document_idle'
            };
            rules.unshift(newRule);
            await ext.storage.local.set({ rules, targetRuleId: newId });
        } catch(e) {
            // fall through and just open the options page
        }
        ext.runtime.openOptionsPage();
    }

    addRuleLink.addEventListener('click', addNewRuleForSite);
    quickAddBtn.addEventListener('click', addNewRuleForSite);

    function renderRules(matchingRules, allRules) {
        rulesList.innerHTML = '';
        matchingRules.forEach(rule => {
            const li = document.createElement('li');
            li.className = 'rule-row';
            li.innerHTML = `
                <div class="rule-info" title="Click to edit rule">
                    <div class="rule-row-name"></div>
                    <div class="rule-row-pattern"></div>
                </div>
                <label class="switch">
                    <input type="checkbox" ${rule.enabled !== false ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            `;
            li.querySelector('.rule-row-name').textContent = rule.name || 'Untitled Rule';
            li.querySelector('.rule-row-pattern').textContent = rule.urlPattern;
            li.querySelector('.rule-info').addEventListener('click', async () => {
                await ext.storage.local.set({ targetRuleId: rule.id });
                ext.runtime.openOptionsPage();
            });
            const toggle = li.querySelector('input[type="checkbox"]');
            toggle.addEventListener('change', async () => {
                rule.enabled = toggle.checked;
                await ext.storage.local.set({ rules: allRules });
                ext.runtime.sendMessage({ action: 'ruleUpdated', rule });
            });
            rulesList.appendChild(li);
        });
    }
});
