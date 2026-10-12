console.log("Email Writer Extension - Content Script Loaded");

const SUPPORTED_TONES = ['Professional', 'Friendly', 'Formal', 'Casual', 'Apologetic', 'Persuasive'];
const SUPPORTED_LENGTHS = ['Short', 'Medium', 'Detailed'];

// Session state to preserve chosen values across interactions
let selectedTone = 'Professional';
let selectedLength = 'Medium';

// Reference to currently active popup
let activePopupInfo = null;

// Reference to active summary panel
let activeSummaryPanel = null;
let lastKnownLocation = typeof window !== 'undefined' ? window.location.href : '';

function getEmailContent(composerRoot) {
    const selectors = [
        '.h7',
        '.a3s.aiL',
        '.a3s',
        '.gmail_quote',
        '[role="presentation"]'
    ];

    // First try relative to the current composer thread if possible
    if (composerRoot) {
        const threadParent = composerRoot.closest('.nH.hx') || composerRoot.closest('div[role="main"]');
        if (threadParent) {
            for (const selector of selectors) {
                const content = threadParent.querySelector(selector);
                if (content && content.innerText && content.innerText.trim()) {
                    return content.innerText.trim();
                }
            }
        }
    }

    // Fall back to document-wide selectors
    for (const selector of selectors) {
        const content = document.querySelector(selector);
        if (content && content.innerText && content.innerText.trim()) {
            return content.innerText.trim();
        }
    }
    return '';
}

function findComposeBox(composerRoot) {
    if (composerRoot) {
        const localBox = composerRoot.querySelector('[role="textbox"][g_editable="true"]')
            || composerRoot.querySelector('[role="textbox"][contenteditable="true"]');
        if (localBox) return localBox;
    }
    return document.querySelector('[role="textbox"][g_editable="true"]')
        || document.querySelector('[role="textbox"][contenteditable="true"]');
}

/**
 * Finds canonical toolbar elements within Gmail.
 * Supports toolbars inside composers (.aDh, [role="dialog"], .btC) as well as
 * action toolbars on conversations/cards when no composer is open.
 */
function findCanonicalToolbars() {
    const composerContainers = document.querySelectorAll('.M9, .aDh, [role="dialog"], td.Bu, .adn');
    const validToolbars = [];

    // Approach 1: Scan each composer or message container for its action toolbar
    composerContainers.forEach((container) => {
        const toolbar = container.querySelector('.btC')
            || container.querySelector('[role="toolbar"]')
            || container.querySelector('.gU.Up');

        if (toolbar && !validToolbars.includes(toolbar)) {
            validToolbars.push(toolbar);
        }
    });

    // Approach 2: Direct lookup fallback for any toolbar not caught by container query
    if (validToolbars.length === 0) {
        const directToolbars = document.querySelectorAll('.btC, [role="toolbar"]');
        directToolbars.forEach((tb) => {
            if (!validToolbars.some((existing) => existing.contains(tb) || tb.contains(existing))) {
                validToolbars.push(tb);
            }
        });
    }

    // Filter out nested toolbars to avoid duplicates
    return validToolbars.filter((tb, idx) => {
        return !validToolbars.some((other, oIdx) => oIdx !== idx && other.contains(tb));
    });
}

function positionPopup(popup, button) {
    if (!popup || !button) return;

    const btnRect = button.getBoundingClientRect();
    const popupWidth = popup.offsetWidth || 320;
    const popupHeight = popup.offsetHeight || 190;
    const margin = 8;

    let left = btnRect.left;
    if (left + popupWidth > window.innerWidth - margin) {
        left = window.innerWidth - popupWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }

    let top = btnRect.top - popupHeight - margin;
    if (top < margin) {
        const spaceBelow = window.innerHeight - btnRect.bottom - margin;
        if (spaceBelow >= popupHeight) {
            top = btnRect.bottom + margin;
        } else {
            top = Math.max(margin, btnRect.top - popupHeight - margin);
        }
    }

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
}

function closeActivePopup() {
    if (activePopupInfo) {
        activePopupInfo.popup.hidden = true;
        activePopupInfo.button.setAttribute('aria-expanded', 'false');
        activePopupInfo = null;
    }
}

function closeActiveSummaryPanel() {
    if (activeSummaryPanel) {
        activeSummaryPanel.remove();
        activeSummaryPanel = null;
    }
}

function showStatusPill(pill, text, type, autoHideMs = 4000) {
    if (!pill) return;
    pill.textContent = text;
    pill.className = `ai-reply-status-pill visible ${type}`;

    if (pill._hideTimeout) {
        clearTimeout(pill._hideTimeout);
    }

    if (autoHideMs > 0) {
        pill._hideTimeout = setTimeout(() => {
            pill.className = 'ai-reply-status-pill';
            pill.textContent = '';
        }, autoHideMs);
    }
}

async function handleGenerate(button, statusPill, composerRoot) {
    try {
        closeActivePopup();
        button.textContent = 'Generating...';
        button.disabled = true;
        showStatusPill(statusPill, 'Generating reply...', 'loading', 0);

        const emailContent = getEmailContent(composerRoot);
        const payload = {
            emailContent: emailContent,
            tone: selectedTone,
            length: selectedLength
        };

        const response = await fetch('http://localhost:8080/api/email/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `API request failed with status ${response.status}`);
        }

        const generatedReply = await response.text();
        const composeBox = findComposeBox(composerRoot);

        if (composeBox) {
            composeBox.focus();
            document.execCommand('insertText', false, generatedReply);
            showStatusPill(statusPill, '✓ Reply inserted', 'success', 4000);
        } else {
            throw new Error('Compose box was not found.');
        }
    } catch (error) {
        console.error('Email Writer Error:', error);
        const userMsg = error && error.message ? error.message : 'Failed to generate reply.';
        showStatusPill(statusPill, `✕ ${userMsg}`, 'error', 6000);
    } finally {
        button.innerHTML = 'AI Reply <span class="ai-btn-arrow">▾</span>';
        button.disabled = false;
    }
}

/* ========================================================================== */
/* Gmail Conversation Thread Extraction (Composer-Independent Architecture)   */
/* ========================================================================== */

/**
 * Checks whether Gmail currently has an open conversation thread view.
 * Accurately differentiates opened email threads from inbox/folder lists.
 */
function isGmailConversationOpen() {
    if (typeof window === 'undefined') return false;

    const hash = window.location.hash || '';

    // If on a top-level folder/list view with no thread ID path
    const isTopLevelListView = /^#(?:inbox|starred|sent|snoozed|drafts|imp|chats|all|spam|trash|category\/[a-zA-Z0-9_\-]+)$/i.test(hash);

    // Check 1: In Gmail, opened conversation threads contain a thread ID path after the folder/label, e.g.:
    // #inbox/FMfcgz..., #all/18..., #sent/..., #label/work/FMfcgz..., #search/.../FMfcgz...
    const threadHashPattern = /#(?:[a-zA-Z0-9_\-+]+)(?:\/[a-zA-Z0-9_\-+]+)*\/(?:[a-zA-Z0-9_\-+]{6,}|p\d+|FMfc[a-zA-Z0-9]+)/;
    if (threadHashPattern.test(hash)) {
        return true;
    }

    if (isTopLevelListView) {
        // In top-level list view, verify if split reading pane or thread is actually open and visible
        if (typeof document !== 'undefined') {
            const visibleSubject = document.querySelector('h2.hP, div.ha h2, [data-thread-perm-id] h2, .hP');
            if (visibleSubject) {
                const isVisible = visibleSubject.offsetParent !== null ||
                    (typeof window.getComputedStyle === 'function' && window.getComputedStyle(visibleSubject).display !== 'none');
                if (isVisible) return true;
            }
            const messageBodies = document.querySelectorAll('.a3s:not([role="textbox"])');
            for (const body of messageBodies) {
                if (!isComposeElement(body) && !body.closest('.zA:not(.adn)')) {
                    const isVisible = body.offsetParent !== null ||
                        (typeof window.getComputedStyle === 'function' && window.getComputedStyle(body).display !== 'none');
                    if (isVisible) return true;
                }
            }
        }
        return false;
    }

    // Check 2: Visible canonical conversation subject header (rendered exclusively in thread view)
    if (typeof document !== 'undefined') {
        const subjectEl = document.querySelector('h2.hP, div.ha h2, [data-thread-perm-id] h2, .hP');
        if (subjectEl) {
            const isVisible = subjectEl.offsetParent !== null ||
                (typeof window.getComputedStyle === 'function' && window.getComputedStyle(subjectEl).display !== 'none');
            if (isVisible) return true;
        }

        // Check 3: Visible message body elements that are not compose textboxes
        const messageBodies = document.querySelectorAll('.a3s:not([role="textbox"])');
        for (const body of messageBodies) {
            if (!isComposeElement(body) && !body.closest('.zA:not(.adn)')) {
                const isVisible = body.offsetParent !== null ||
                    (typeof window.getComputedStyle === 'function' && window.getComputedStyle(body).display !== 'none');
                if (isVisible) return true;
            }
        }
    }

    return false;
}

/**
 * Locates the enclosing container of the active Gmail conversation.
 * Operates independently of any reply composer.
 */
function findActiveConversationContainer() {
    if (typeof document === 'undefined') return null;

    // 1. Walk up from canonical conversation subject element
    const subjectEl = document.querySelector('h2.hP, div.ha h2, [data-thread-perm-id] h2, .hP');
    if (subjectEl) {
        let ancestor = subjectEl.parentElement;
        while (ancestor && ancestor !== document.body) {
            if (ancestor.querySelector && ancestor.querySelector('.a3s, .ii.gt, .adn, .gs')) {
                return ancestor;
            }
            ancestor = ancestor.parentElement;
        }
    }

    // 2. Candidate Gmail conversation container classes
    const candidateSelectors = [
        '.nH.hx',
        '.nH.if',
        'div[data-legacy-thread-id]',
        'div[data-thread-perm-id]',
        'div[role="main"] .AO',
        'div[role="main"]',
        '.AO'
    ];

    for (const sel of candidateSelectors) {
        const matches = document.querySelectorAll(sel);
        for (const el of matches) {
            if (el.querySelector('.a3s, .ii.gt, .adn, .gs')) {
                return el;
            }
        }
    }

    const mainEl = document.querySelector('div[role="main"]');
    if (mainEl && mainEl.querySelector('.a3s, .ii.gt, .adn, .gs')) {
        return mainEl;
    }

    return document.body;
}

/**
 * Extracts conversation subject line if available.
 */
function extractConversationSubject(container) {
    if (typeof document === 'undefined') return '';

    const subjectEl = container?.querySelector('h2.hP, div.ha h2, [data-thread-perm-id] h2, .hP')
        || document.querySelector('h2.hP, div.ha h2, [data-thread-perm-id] h2, .hP');
    if (subjectEl) {
        const text = (subjectEl.innerText || subjectEl.textContent || '').trim();
        if (text) return text;
    }

    const title = document.title || '';
    const parts = title.split(' - ');
    if (parts.length >= 2) {
        const candidate = parts[0].trim();
        if (candidate && !['Inbox', 'Gmail', 'Sent', 'Drafts', 'Starred', 'Spam', 'Trash'].includes(candidate)) {
            return candidate;
        }
    }

    return '';
}

/**
 * Detects whether an element belongs to an active reply composer or draft box.
 * Prevents reply drafts from being mistakenly extracted as original email messages.
 */
function isComposeElement(el) {
    if (!el) return false;
    if (
        el.getAttribute('role') === 'textbox' ||
        el.getAttribute('contenteditable') === 'true' ||
        el.classList.contains('editable')
    ) {
        return true;
    }
    // Check if contained inside a compose textbox wrapper
    if (el.closest('[role="textbox"], [contenteditable="true"], .editable')) {
        return true;
    }
    // Check if inside a compose dialog (unless it's an expanded message card)
    const composeDialog = el.closest('.aDh, [role="dialog"]');
    if (composeDialog && composeDialog.querySelector('[role="textbox"]')) {
        // Only consider compose element if inside the compose box area
        if (el.closest('.Ap, .Am, .Al, .btC, [role="toolbar"]')) {
            return true;
        }
    }
    return false;
}

/**
 * Cleans an email body element by removing signatures, nested quoted replies,
 * attachment chips, buttons, and smart action elements.
 * Works safely with both detached and attached DOM nodes.
 */
function extractSanitizedBodyText(bodyEl) {
    if (!bodyEl) return '';

    // Ignore compose textboxes and draft inputs
    if (isComposeElement(bodyEl)) {
        return '';
    }

    // Ignore inbox list row previews
    if (bodyEl.closest('.zA:not(.adn)')) {
        return '';
    }

    const clone = bodyEl.cloneNode(true);
    const stripSelectors = [
        '.gmail_signature',
        '[data-smartmail="gmail_signature"]',
        '.gmail_extra',
        '.gmail_quote',
        'blockquote',
        'div.gmail_quote',
        'div[aria-label*="Quoted"]',
        'div[aria-label*="quoted"]',
        'button',
        '[role="button"]',
        '.a6S', // Attachment download chips
        '.a5q', // Attachment preview chips
        '.hq',  // Attachment container
        'div[data-tooltip*="attachment"]',
        'div.aQi',
        '.att',
        '.ajU', // "Show trimmed content" buttons
        '.ajV',
        '.ajT',
        '.a3I',
        '.hi',  // Smart reply chips
        '.v1'
    ];

    stripSelectors.forEach((sel) => {
        try {
            clone.querySelectorAll(sel).forEach((el) => el.remove());
        } catch (_) {}
    });

    // In detached nodes, innerText may be empty depending on browser layout attachment;
    // textContent ensures robust fallback in all environments.
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text;
}

/**
 * Extracts sender name and email from a message container or its preceding header.
 */
function extractSenderFromNode(node) {
    if (!node) return 'Unknown Sender';

    const senderEl = node.querySelector('.gD')
        || node.querySelector('span[email]')
        || node.querySelector('.zF')
        || node.querySelector('.yP')
        || node.querySelector('.bDA')
        || node.querySelector('.go');

    if (senderEl) {
        const name = (senderEl.getAttribute('name') || senderEl.innerText || senderEl.textContent || '').trim();
        const email = (senderEl.getAttribute('email') || '').trim();
        if (name && email && name.toLowerCase() !== email.toLowerCase()) {
            return `${name} <${email}>`;
        }
        return name || email || 'Unknown Sender';
    }

    return 'Unknown Sender';
}

/**
 * Extracts date timestamp from a message container or header.
 */
function extractDateFromNode(node) {
    if (!node) return '';

    const dateEl = node.querySelector('.g3')
        || node.querySelector('.bi4')
        || node.querySelector('[data-timestamp]')
        || node.querySelector('span[title]');

    if (dateEl) {
        return (dateEl.getAttribute('title') || dateEl.innerText || dateEl.textContent || '').trim();
    }

    return '';
}

/**
 * Finds the nearest enclosing message wrapper for a given body element.
 */
function findEnclosingMessageCard(bodyEl) {
    if (!bodyEl) return null;
    return bodyEl.closest('.adn, .gs, div[data-message-id], div[data-legacy-message-id], [role="listitem"], .h7, tr, table')
        || bodyEl.parentElement;
}

/**
 * Logs temporary, clearly labelled console diagnostics without exposing sensitive data.
 */
function logExtractionDiagnostics({
    url,
    isConversationOpen,
    detectedContainer,
    selectorCounts,
    extractedMessages,
    hasCollapsed
}) {
    console.group('[AI Email Summarizer Diagnostic]');
    console.log('1. Current URL:', url);
    console.log('   Is conversation open?:', isConversationOpen);
    console.log('   Detected conversation container:', detectedContainer);
    console.log('2. Selector match counts:', selectorCounts);
    console.log('3. Collapsed messages detected:', hasCollapsed);
    console.log('4. Total unique messages extracted:', extractedMessages.length);
    extractedMessages.forEach((msg, idx) => {
        console.log(`   Message ${idx + 1}: [body length: ${msg.body.length} chars] [sender: ${msg.sender !== 'Unknown Sender' ? 'found' : 'missing'}] [date: ${Boolean(msg.date)}] [subject: ${Boolean(msg.subject)}]`);
    });
    console.groupEnd();
}

/**
 * Extracts email messages from the opened Gmail conversation.
 * COMPLETELY DECOUPLED from any reply composer.
 * Functions reliably in both normal conversation views and when a reply box is open.
 */
function extractThreadData() {
    const isConvOpen = isGmailConversationOpen();

    if (!isConvOpen) {
        logExtractionDiagnostics({
            url: typeof window !== 'undefined' ? window.location.href : '',
            isConversationOpen: false,
            detectedContainer: 'none (inbox or list view)',
            selectorCounts: {},
            extractedMessages: [],
            hasCollapsed: false
        });
        return {
            isOpen: false,
            messages: [],
            hasCollapsed: false,
            subject: ''
        };
    }

    const container = findActiveConversationContainer();
    const subject = extractConversationSubject(container);

    // Diagnostic counts for Gmail selectors
    const selectorCounts = {
        'h2.hP (Subject)': document.querySelectorAll('h2.hP').length,
        '.adn': container ? container.querySelectorAll('.adn').length : 0,
        '.gs': container ? container.querySelectorAll('.gs').length : 0,
        '[role="listitem"]': container ? container.querySelectorAll('[role="listitem"]').length : 0,
        'div[data-message-id]': container ? container.querySelectorAll('div[data-message-id]').length : 0,
        '.a3s': container ? container.querySelectorAll('.a3s').length : 0,
        '.ii.gt': container ? container.querySelectorAll('.ii.gt').length : 0,
        '.adx (older messages)': container ? container.querySelectorAll('.adx').length : 0,
        '.kQ, .kv (collapsed rows)': container ? container.querySelectorAll('.kQ, .kv').length : 0,
        'aria-expanded=false': container ? container.querySelectorAll('[aria-expanded="false"]').length : 0
    };

    // Detect collapsed messages in Gmail
    const collapsedElements = container
        ? container.querySelectorAll('.adx, .kQ, .kv, [aria-expanded="false"][role="listitem"], .adn[aria-expanded="false"]')
        : [];
    const hasCollapsed = collapsedElements.length > 0;

    const messages = [];
    const seenBodies = new Set();

    function addMessage({ sender, date, body }) {
        if (!body || !body.trim()) return;
        const normalizedKey = body.replace(/\s+/g, ' ').slice(0, 150);
        if (seenBodies.has(normalizedKey)) return;
        seenBodies.add(normalizedKey);

        messages.push({
            order: messages.length + 1,
            subject: subject || '',
            sender: sender || 'Unknown Sender',
            date: date || '',
            body: body
        });
    }

    // Strategy 1: Look for structured message cards (.adn, .gs, div[data-message-id], [role="listitem"])
    if (container) {
        let cardNodes = Array.from(container.querySelectorAll('.adn, .gs, div[data-message-id], div[data-legacy-message-id]'));
        if (cardNodes.length === 0) {
            cardNodes = Array.from(container.querySelectorAll('[role="listitem"]'));
        }

        cardNodes.forEach((card) => {
            const bodyEl = card.querySelector('.a3s') || card.querySelector('.ii.gt');
            if (!bodyEl || isComposeElement(bodyEl)) return;

            const bodyText = extractSanitizedBodyText(bodyEl);
            if (!bodyText) return;

            const sender = extractSenderFromNode(card);
            const date = extractDateFromNode(card);

            addMessage({ sender, date, body: bodyText });
        });
    }

    // Strategy 2: Direct scan for all message bodies (.a3s, .ii.gt) within conversation container
    if (messages.length === 0 && container) {
        const bodyNodes = Array.from(container.querySelectorAll('.a3s, .ii.gt'));
        bodyNodes.forEach((bodyEl) => {
            if (isComposeElement(bodyEl) || bodyEl.closest('.zA:not(.adn)')) return;

            const bodyText = extractSanitizedBodyText(bodyEl);
            if (!bodyText) return;

            const card = findEnclosingMessageCard(bodyEl);
            const sender = extractSenderFromNode(card || bodyEl);
            const date = extractDateFromNode(card || bodyEl);

            addMessage({ sender, date, body: bodyText });
        });
    }

    // Strategy 3: Document-wide scan for .a3s (resilient to container selection boundary issues)
    if (messages.length === 0) {
        const docBodies = Array.from(document.querySelectorAll('.a3s'));
        docBodies.forEach((bodyEl) => {
            if (isComposeElement(bodyEl) || bodyEl.closest('.zA:not(.adn)')) return;

            const bodyText = extractSanitizedBodyText(bodyEl);
            if (!bodyText) return;

            const card = findEnclosingMessageCard(bodyEl);
            const sender = extractSenderFromNode(card || bodyEl);
            const date = extractDateFromNode(card || bodyEl);

            addMessage({ sender, date, body: bodyText });
        });
    }

    // Diagnostics report
    const detectedContainerDesc = container ? `${container.tagName.toLowerCase()}${container.className ? '.' + container.className.split(' ').slice(0, 2).join('.') : ''}` : 'none';
    logExtractionDiagnostics({
        url: typeof window !== 'undefined' ? window.location.href : '',
        isConversationOpen: true,
        detectedContainer: detectedContainerDesc,
        selectorCounts,
        extractedMessages: messages,
        hasCollapsed
    });

    return {
        isOpen: true,
        messages,
        hasCollapsed,
        subject
    };
}

/**
 * Formats extracted thread messages into untrusted text block for Gemini summarization.
 * Applies a strict maximum character limit to avoid overflowing backend or Gemini tokens.
 */
function formatThreadForSummary(threadData) {
    if (!threadData || !threadData.messages || threadData.messages.length === 0) {
        return '';
    }

    const MAX_THREAD_CHARS = 48000;
    let formatted = '';

    if (threadData.subject) {
        formatted += `Subject: ${threadData.subject}\n\n`;
    }

    if (threadData.hasCollapsed) {
        formatted += `[Notice: This email thread contains collapsed messages in Gmail that were not expanded. Only visible messages are included below.]\n\n`;
    }

    threadData.messages.forEach((msg) => {
        let header = `--- Message ${msg.order} ---`;
        if (msg.sender && msg.sender !== 'Unknown Sender') {
            header += `\nFrom: ${msg.sender}`;
        }
        if (msg.date) {
            header += `\nDate: ${msg.date}`;
        }
        formatted += `${header}\nContent:\n${msg.body}\n\n`;
    });

    formatted = formatted.trim();

    if (formatted.length > MAX_THREAD_CHARS) {
        formatted = formatted.slice(0, MAX_THREAD_CHARS) + '\n\n[Thread truncated due to maximum length limit]';
    }

    return formatted;
}

/**
 * Parses Gemini response into 5 structured sections.
 */
function parseSummarySections(rawText) {
    if (!rawText) return [{ title: 'Summary Overview', content: '' }];

    const targetSections = [
        'Main Points',
        'Decisions Made',
        'Action Items',
        'Deadlines and Important Dates',
        'Unanswered Questions'
    ];

    const lines = rawText.split('\n');
    const parsed = [];
    let currentTitle = null;
    let currentContentLines = [];

    function flushCurrent() {
        if (currentTitle) {
            parsed.push({
                title: currentTitle,
                content: currentContentLines.join('\n').trim()
            });
            currentContentLines = [];
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let matchedTitle = null;

        for (const title of targetSections) {
            const clean = line.replace(/^[#*\s\d.-]+/, '').replace(/[:*#\s]+$/, '').trim();
            if (clean.toLowerCase() === title.toLowerCase()) {
                matchedTitle = title;
                break;
            }
        }

        if (matchedTitle) {
            flushCurrent();
            currentTitle = matchedTitle;
        } else {
            if (currentTitle) {
                currentContentLines.push(line);
            } else if (line.trim()) {
                currentContentLines.push(line);
            }
        }
    }
    flushCurrent();

    if (parsed.length === 0) {
        return [{ title: 'Summary Overview', content: rawText.trim() }];
    }

    return parsed;
}

/**
 * Renders the Summary Panel with safe DOM manipulation (strictly NO innerHTML for AI output).
 */
function showSummaryPanel({ state, summary = '', error = '', hasCollapsed = false }) {
    closeActiveSummaryPanel();

    const panel = document.createElement('div');
    panel.className = 'ai-summary-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Email Thread Summary');

    // Panel Header
    const header = document.createElement('div');
    header.className = 'ai-summary-header';

    const titleBox = document.createElement('div');
    titleBox.className = 'ai-summary-title-box';

    const titleIcon = document.createElement('span');
    titleIcon.className = 'ai-summary-header-icon';
    titleIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;

    const titleText = document.createElement('span');
    titleText.className = 'ai-summary-title';
    titleText.textContent = 'Email Thread Summary';

    titleBox.appendChild(titleIcon);
    titleBox.appendChild(titleText);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ai-summary-close-icon';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Close summary panel');
    closeBtn.addEventListener('click', closeActiveSummaryPanel);

    header.appendChild(titleBox);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Panel Body
    const body = document.createElement('div');
    body.className = 'ai-summary-body';

    if (state === 'loading') {
        const loadingBox = document.createElement('div');
        loadingBox.className = 'ai-summary-loading-box';

        const spinner = document.createElement('div');
        spinner.className = 'ai-summary-spinner';

        const loadingText = document.createElement('p');
        loadingText.className = 'ai-summary-loading-text';
        loadingText.textContent = 'Extracting conversation and analyzing with AI...';

        loadingBox.appendChild(spinner);
        loadingBox.appendChild(loadingText);

        if (hasCollapsed) {
            const warningNotice = document.createElement('div');
            warningNotice.className = 'ai-summary-alert';
            warningNotice.textContent = 'Notice: Collapsed messages detected. Generating summary of currently visible messages...';
            loadingBox.appendChild(warningNotice);
        }

        body.appendChild(loadingBox);
    } else if (state === 'error') {
        const errorBox = document.createElement('div');
        errorBox.className = 'ai-summary-error-box';

        const errorIcon = document.createElement('div');
        errorIcon.className = 'ai-summary-error-icon';
        errorIcon.textContent = '✕';

        const errorTitle = document.createElement('h4');
        errorTitle.className = 'ai-summary-error-title';
        errorTitle.textContent = 'Unable to Summarize Thread';

        const errorMsg = document.createElement('p');
        errorMsg.className = 'ai-summary-error-msg';
        errorMsg.textContent = error || 'An unexpected error occurred.';

        errorBox.appendChild(errorIcon);
        errorBox.appendChild(errorTitle);
        errorBox.appendChild(errorMsg);
        body.appendChild(errorBox);
    } else if (state === 'success') {
        // Collapsed messages alert banner
        if (hasCollapsed) {
            const banner = document.createElement('div');
            banner.className = 'ai-summary-alert';
            banner.setAttribute('role', 'alert');

            const alertIcon = document.createElement('span');
            alertIcon.className = 'ai-alert-icon';
            alertIcon.textContent = '⚠️ ';

            const alertText = document.createElement('span');
            alertText.textContent = 'This conversation contains collapsed or hidden messages in Gmail. Only visible messages were summarized. To include older messages, expand them in Gmail and summarize again.';

            banner.appendChild(alertIcon);
            banner.appendChild(alertText);
            body.appendChild(banner);
        }

        // Render the 5 sections safely using textContent
        const sections = parseSummarySections(summary);
        sections.forEach((sec) => {
            const secCard = document.createElement('div');
            secCard.className = 'ai-summary-section';

            const secTitle = document.createElement('h4');
            secTitle.className = 'ai-summary-section-title';
            secTitle.textContent = sec.title;
            secCard.appendChild(secTitle);

            const secContent = document.createElement('div');
            secContent.className = 'ai-summary-section-content';

            const lines = sec.content.split('\n');
            let currentUl = null;

            lines.forEach((l) => {
                const trimmed = l.trim();
                if (!trimmed) return;

                if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
                    if (!currentUl) {
                        currentUl = document.createElement('ul');
                        currentUl.className = 'ai-summary-list';
                        secContent.appendChild(currentUl);
                    }
                    const li = document.createElement('li');
                    li.textContent = trimmed.replace(/^[-*•]\s*/, '').trim();
                    currentUl.appendChild(li);
                } else {
                    currentUl = null;
                    const p = document.createElement('p');
                    p.className = 'ai-summary-paragraph';
                    p.textContent = trimmed;
                    secContent.appendChild(p);
                }
            });

            secCard.appendChild(secContent);
            body.appendChild(secCard);
        });
    }

    panel.appendChild(body);

    // Panel Footer
    const footer = document.createElement('div');
    footer.className = 'ai-summary-footer';

    if (state === 'success') {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'ai-summary-btn ai-summary-btn-copy';
        copyBtn.textContent = 'Copy Summary';
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(summary);
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '✓ Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('Failed to copy summary to clipboard:', err);
            }
        });
        footer.appendChild(copyBtn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'ai-summary-btn ai-summary-btn-dismiss';
    dismissBtn.textContent = 'Close';
    dismissBtn.addEventListener('click', closeActiveSummaryPanel);
    footer.appendChild(dismissBtn);

    panel.appendChild(footer);

    document.body.appendChild(panel);
    activeSummaryPanel = panel;
}

/* ========================================================================== */
/* Top Conversation Toolbar Summarize Integration                            */
/* ========================================================================== */

let isSummarizingInProgress = false;

/**
 * Removes any top toolbar summarize button instances from the DOM.
 */
function removeTopToolbarButton() {
    if (typeof document === 'undefined') return;
    const existingBtns = document.querySelectorAll('#ai-top-summarize-btn, [data-ai-top-summarize-btn="true"]');
    existingBtns.forEach((btn) => btn.remove());
}

/**
 * Finds the canonical top conversation action toolbar in Gmail.
 * Ensures the toolbar belongs to an opened conversation and excludes compose dialogs.
 */
function findTopConversationToolbar() {
    if (typeof document === 'undefined' || !isGmailConversationOpen()) return null;

    // Candidate top toolbar containers in Gmail
    const candidateToolbars = Array.from(document.querySelectorAll('div[gh="mtb"], div.D.E.G-atb, div.G-atb, [role="toolbar"].G-atb'));

    // Filter out toolbars inside composers and hidden ones
    const visibleToolbars = candidateToolbars.filter((tb) => {
        if (tb.closest('.M9, .aDh, [role="dialog"], td.Bu')) return false;
        if (typeof window !== 'undefined' && window.getComputedStyle) {
            try {
                if (window.getComputedStyle(tb).display === 'none') return false;
            } catch (_) {}
        }
        return tb.offsetParent !== null || tb.offsetWidth > 0 || tb.offsetHeight > 0;
    });

    // Check for conversation-specific action buttons or back button in toolbar
    for (const tb of visibleToolbars) {
        const hasThreadActions = tb.querySelector(
            '[act="19"], [act="20"], .ar6, [data-tooltip*="Back" i], [aria-label*="Back" i], ' +
            '[act="7"], [act="9"], [act="10"], [data-tooltip*="Archive" i], [aria-label*="Archive" i], ' +
            '[data-tooltip*="Delete" i], [aria-label*="Delete" i]'
        );
        if (hasThreadActions) {
            return tb;
        }
    }

    // Strategy 2: Active toolbar inside main conversation container
    const mainToolbar = document.querySelector('div[role="main"] div[gh="mtb"], div[role="main"] div.G-atb, .AO div[gh="mtb"], .AO div.G-atb');
    if (mainToolbar && !mainToolbar.closest('.M9, .aDh, [role="dialog"]')) {
        return mainToolbar;
    }

    // Strategy 3: First visible toolbar not in a composer
    if (visibleToolbars.length > 0) {
        return visibleToolbars[0];
    }

    return null;
}

/**
 * Places the button within the toolbar:
 * Immediately after the native label/move actions and BEFORE the More menu.
 * If More menu cannot be determined, places it before right-side navigation controls.
 */
function insertTopToolbarButton(toolbar, topBtn) {
    if (!toolbar || !topBtn) return false;

    const actionContainer = (toolbar.querySelector && toolbar.querySelector('.aqL'))
        || (toolbar.querySelector && toolbar.querySelector('.G-tF'))
        || toolbar;

    // Try Placement Option 1: Immediately before the native "More" menu
    const moreBtn = actionContainer.querySelector ? actionContainer.querySelector(
        '[aria-label*="More actions" i], [data-tooltip*="More actions" i], ' +
        '[aria-label="More" i], [data-tooltip="More" i], ' +
        '[aria-label*="More" i][role="button"], [data-tooltip*="More" i][role="button"], ' +
        'div.nf, div.bzn, [act="17"], [act="24"]'
    ) : null;

    if (moreBtn) {
        // Find top-level child of actionContainer corresponding to moreBtn
        let moreContainer = moreBtn;
        while (moreContainer && moreContainer.parentElement && moreContainer.parentElement !== actionContainer) {
            moreContainer = moreContainer.parentElement;
        }
        if (moreContainer && moreContainer.parentElement === actionContainer) {
            if (actionContainer.insertBefore) {
                actionContainer.insertBefore(topBtn, moreContainer);
                return true;
            }
        }
    }

    // Placement Option 2: Before the last .G-Ni button group in actionContainer if multiple exist
    const groups = actionContainer.querySelectorAll ? actionContainer.querySelectorAll('.G-Ni') : [];
    if (groups && groups.length >= 2) {
        let lastGroup = groups[groups.length - 1];
        while (lastGroup && lastGroup.parentElement && lastGroup.parentElement !== actionContainer) {
            lastGroup = lastGroup.parentElement;
        }
        if (lastGroup && lastGroup.parentElement === actionContainer) {
            if (actionContainer.insertBefore) {
                actionContainer.insertBefore(topBtn, lastGroup);
                return true;
            }
        }
    }

    // Placement Option 3: In .G-tF between .aqL (main actions) and .ar5 (right-side navigation)
    const gtfContainer = toolbar.querySelector ? toolbar.querySelector('.G-tF') : null;
    const navControls = toolbar.querySelector ? toolbar.querySelector('.ar5, .Ad') : null;
    if (gtfContainer && navControls && navControls.parentElement === gtfContainer && gtfContainer.insertBefore) {
        gtfContainer.insertBefore(topBtn, navControls);
        return true;
    }

    // Fallback: append to actionContainer
    if (actionContainer.appendChild) {
        actionContainer.appendChild(topBtn);
        return true;
    }
    return false;
}

/**
 * Attaches direct click and mouse event listeners to the top Summarize button.
 */
function attachTopButtonListeners(topBtn) {
    if (!topBtn) return;

    topBtn.onclick = (e) => {
        console.log('[AI Email Writer] Top Summarize button direct onclick fired');
        e.preventDefault();
        e.stopPropagation();
        handleSummarize(topBtn, null);
    };

    // Stop mouse event propagation to prevent Gmail's toolbar listeners from cancelling the click
    topBtn.onmousedown = (e) => {
        e.stopPropagation();
    };
    topBtn.onpointerdown = (e) => {
        e.stopPropagation();
    };
}

/**
 * Injects a compact, Gmail-styled "Summarize" button into the top conversation toolbar.
 * Strictly idempotent: verifies conversation is open, places before More menu,
 * and ensures click listeners are active across SPA transitions.
 */
function injectTopToolbarButton() {
    if (typeof document === 'undefined') return;

    if (!isGmailConversationOpen()) {
        removeTopToolbarButton();
        return;
    }

    const toolbar = findTopConversationToolbar();
    if (!toolbar) {
        return;
    }

    // Locate existing button or create a fresh one
    let topBtn = toolbar.querySelector('#ai-top-summarize-btn, [data-ai-top-summarize-btn="true"]');

    // Clean up any stray duplicate buttons in the document
    const allButtons = document.querySelectorAll('#ai-top-summarize-btn, [data-ai-top-summarize-btn="true"]');
    if (allButtons.length > 1) {
        allButtons.forEach((btn) => {
            if (btn !== topBtn) {
                btn.remove();
            }
        });
    }

    if (!topBtn) {
        topBtn = document.createElement('button');
        topBtn.type = 'button';
        topBtn.id = 'ai-top-summarize-btn';
        topBtn.className = 'ai-top-summarize-btn';
        topBtn.setAttribute('data-ai-top-summarize-btn', 'true');
        topBtn.setAttribute('data-tooltip', 'Summarize this email conversation');
        topBtn.setAttribute('aria-label', 'Summarize this email conversation');
        topBtn.setAttribute('title', 'Summarize this email conversation');
        topBtn.innerHTML = '<svg class="ai-btn-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg><span class="ai-top-btn-label">Summarize</span>';

        insertTopToolbarButton(toolbar, topBtn);
    } else {
        // If it exists but is misplaced after More menu, reposition it before More menu
        const moreBtn = toolbar.querySelector(
            '[aria-label*="More actions" i], [data-tooltip*="More actions" i], ' +
            '[aria-label="More" i], [data-tooltip="More" i], ' +
            '[aria-label*="More" i][role="button"], [data-tooltip*="More" i][role="button"], ' +
            'div.nf, div.bzn, [act="17"], [act="24"]'
        );
        if (moreBtn && topBtn.compareDocumentPosition && (topBtn.compareDocumentPosition(moreBtn) & Node.DOCUMENT_POSITION_PRECEDING)) {
            insertTopToolbarButton(toolbar, topBtn);
        }
    }

    // Attach / refresh listeners on the button
    attachTopButtonListeners(topBtn);
}

/**
 * Handles Summarize Thread button click.
 * Works uniformly whether invoked from the reply composer or top toolbar.
 */
async function handleSummarize(button, statusPill) {
    if (isSummarizingInProgress) {
        console.log('[AI Email Writer] Summarization already in progress. Ignoring repeated click.');
        return;
    }

    if (button && button.disabled) return;

    console.log('[AI Email Writer] handleSummarize invoked. Initiating thread summarization...');

    // Collect all summarize buttons to synchronize disabled and loading states
    const allSummarizeBtns = typeof document !== 'undefined'
        ? Array.from(document.querySelectorAll('.ai-summarize-btn, #ai-top-summarize-btn, [data-ai-top-summarize-btn="true"]'))
        : (button ? [button] : []);

    try {
        isSummarizingInProgress = true;
        closeActivePopup();

        // 1. Disable buttons to prevent duplicate requests and show loading state
        allSummarizeBtns.forEach((btn) => {
            btn.disabled = true;
            if (btn.id === 'ai-top-summarize-btn' || btn.hasAttribute('data-ai-top-summarize-btn')) {
                btn.innerHTML = '<span class="ai-btn-spinner"></span> <span class="ai-top-btn-label">Summarizing...</span>';
            } else {
                btn.innerHTML = '<span class="ai-btn-spinner"></span> Summarizing...';
            }
        });

        showStatusPill(statusPill, 'Extracting thread...', 'loading', 0);

        // 2. Extract thread messages (INDEPENDENT of any reply composer)
        const threadData = extractThreadData();
        console.log('[AI Email Writer] Thread extraction result:', {
            isOpen: threadData.isOpen,
            messageCount: threadData.messages ? threadData.messages.length : 0,
            hasCollapsed: threadData.hasCollapsed,
            subject: threadData.subject
        });

        // If user is viewing inbox list rather than an open conversation
        if (!threadData.isOpen) {
            throw new Error('No conversation is currently open. Please open an email thread in Gmail to summarize it.');
        }

        if (!threadData.messages || threadData.messages.length === 0) {
            console.warn('[AI Email Writer] No email messages could be found in the current conversation.');
            throw new Error('No email messages could be found in the visible conversation. Please ensure an email conversation is open and messages are expanded in Gmail.');
        }

        const emailContent = formatThreadForSummary(threadData);
        if (!emailContent || !emailContent.trim()) {
            throw new Error('No readable email content could be extracted from this thread.');
        }

        // Show panel in loading state
        showSummaryPanel({
            state: 'loading',
            hasCollapsed: threadData.hasCollapsed
        });

        showStatusPill(statusPill, 'Summarizing with AI...', 'loading', 0);

        // 3. Send request to backend
        console.log('[AI Email Writer] Sending request to POST http://localhost:8080/api/email/summarize...');
        const response = await fetch('http://localhost:8080/api/email/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ emailContent })
        });

        if (!response.ok) {
            let errorMsg = `API request failed with status ${response.status}`;
            try {
                const errData = await response.json();
                if (errData && errData.error) {
                    errorMsg = errData.error;
                }
            } catch {
                const errText = await response.text();
                if (errText) errorMsg = errText;
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        const summaryText = data && data.summary ? data.summary : '';

        if (!summaryText) {
            throw new Error('Empty summary returned from AI service.');
        }

        console.log('[AI Email Writer] Summarization successful. Rendering summary panel.');

        // 4. Render summary panel
        showSummaryPanel({
            state: 'success',
            summary: summaryText,
            hasCollapsed: threadData.hasCollapsed
        });

        showStatusPill(statusPill, '✓ Summary ready', 'success', 4000);
    } catch (error) {
        console.error('[AI Email Writer] Summarization failed:', error);
        const userMsg = error && error.message ? error.message : 'Failed to summarize thread.';
        showStatusPill(statusPill, `✕ ${userMsg}`, 'error', 6000);
        showSummaryPanel({
            state: 'error',
            error: userMsg
        });
    } finally {
        isSummarizingInProgress = false;
        allSummarizeBtns.forEach((btn) => {
            btn.disabled = false;
            if (btn.id === 'ai-top-summarize-btn' || btn.hasAttribute('data-ai-top-summarize-btn')) {
                btn.innerHTML = '<svg class="ai-btn-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg><span class="ai-top-btn-label">Summarize</span>';
            } else {
                btn.innerHTML = '<svg class="ai-btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Summarize Thread';
            }
        });
    }
}

function createPopup(button, statusPill, composerRoot) {
    const popup = document.createElement('div');
    popup.className = 'ai-reply-popup';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'AI Reply Tone and Length Settings');

    // Header
    const header = document.createElement('div');
    header.className = 'ai-popup-header';

    const title = document.createElement('span');
    title.className = 'ai-popup-title';
    title.textContent = 'AI Reply Options';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ai-popup-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Close options');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActivePopup();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Tone group
    const toneGroup = document.createElement('div');
    toneGroup.className = 'ai-popup-group';

    const toneLabel = document.createElement('label');
    toneLabel.className = 'ai-popup-label';
    toneLabel.textContent = 'Tone';

    const toneSelect = document.createElement('select');
    toneSelect.className = 'ai-popup-select';
    toneSelect.setAttribute('aria-label', 'Reply Tone');

    SUPPORTED_TONES.forEach((tone) => {
        const option = document.createElement('option');
        option.value = tone;
        option.textContent = tone;
        toneSelect.appendChild(option);
    });
    toneSelect.value = selectedTone;

    toneSelect.addEventListener('change', () => {
        selectedTone = toneSelect.value;
        closeActivePopup();
    });

    toneGroup.appendChild(toneLabel);
    toneGroup.appendChild(toneSelect);

    // Length group
    const lengthGroup = document.createElement('div');
    lengthGroup.className = 'ai-popup-group';

    const lengthLabel = document.createElement('label');
    lengthLabel.className = 'ai-popup-label';
    lengthLabel.textContent = 'Reply Length';

    const lengthSelect = document.createElement('select');
    lengthSelect.className = 'ai-popup-select';
    lengthSelect.setAttribute('aria-label', 'Reply Length');

    SUPPORTED_LENGTHS.forEach((len) => {
        const option = document.createElement('option');
        option.value = len;
        option.textContent = len;
        lengthSelect.appendChild(option);
    });
    lengthSelect.value = selectedLength;

    lengthSelect.addEventListener('change', () => {
        selectedLength = lengthSelect.value;
        closeActivePopup();
    });

    lengthGroup.appendChild(lengthLabel);
    lengthGroup.appendChild(lengthSelect);

    // Footer with explicit Generate Reply button
    const footer = document.createElement('div');
    footer.className = 'ai-popup-footer';

    const generateBtn = document.createElement('button');
    generateBtn.type = 'button';
    generateBtn.className = 'ai-popup-generate-btn';
    generateBtn.textContent = 'Generate Reply';
    generateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleGenerate(button, statusPill, composerRoot);
    });

    footer.appendChild(generateBtn);

    popup.appendChild(header);
    popup.appendChild(toneGroup);
    popup.appendChild(lengthGroup);
    popup.appendChild(footer);

    popup.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.body.appendChild(popup);
    return { popup, toneSelect, lengthSelect };
}

function injectControlsIntoToolbar(toolbar) {
    const composerRoot = toolbar.closest('.M9, .aDh, [role="dialog"], td.Bu, .adn') || toolbar.parentElement;

    if (composerRoot) {
        const existingWrappers = composerRoot.querySelectorAll('[data-ai-email-writer-button="true"]');
        if (existingWrappers.length > 0) {
            for (let i = 1; i < existingWrappers.length; i++) {
                existingWrappers[i].remove();
            }
            return;
        }
    }

    if (toolbar.querySelector('[data-ai-email-writer-button="true"]') || toolbar.hasAttribute('data-ai-button-injected')) {
        return;
    }

    toolbar.setAttribute('data-ai-button-injected', 'true');

    const wrapper = document.createElement('div');
    wrapper.className = 'ai-reply-wrapper';
    wrapper.setAttribute('data-ai-email-writer-button', 'true');

    // AI Reply Button
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-reply-btn';
    button.innerHTML = 'AI Reply <span class="ai-btn-arrow">▾</span>';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('data-tooltip', 'Configure AI Reply & Generate');

    const statusPill = document.createElement('span');
    statusPill.className = 'ai-reply-status-pill';
    statusPill.setAttribute('role', 'status');
    statusPill.setAttribute('aria-live', 'polite');

    const { popup, toneSelect, lengthSelect } = createPopup(button, statusPill, composerRoot);

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (activePopupInfo && activePopupInfo.popup === popup) {
            closeActivePopup();
            return;
        }

        closeActivePopup();

        toneSelect.value = selectedTone;
        lengthSelect.value = selectedLength;

        popup.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        positionPopup(popup, button);
        activePopupInfo = { popup, button, toneSelect, lengthSelect };

        toneSelect.focus();
    });

    // Summarize Thread Button (beside AI Reply button)
    // Invokes handleSummarize independently of any reply composer!
    const summarizeBtn = document.createElement('button');
    summarizeBtn.type = 'button';
    summarizeBtn.className = 'ai-summarize-btn';
    summarizeBtn.innerHTML = '<svg class="ai-btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Summarize Thread';
    summarizeBtn.setAttribute('data-tooltip', 'Summarize visible email conversation thread');

    summarizeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSummarize(summarizeBtn, statusPill);
    });

    wrapper.appendChild(button);
    wrapper.appendChild(summarizeBtn);
    wrapper.appendChild(statusPill);
    toolbar.insertBefore(wrapper, toolbar.firstChild);
}

let injectionDebounceTimer = null;

function cleanupDuplicateButtons() {
    const composerContainers = document.querySelectorAll('.M9, .aDh, [role="dialog"], td.Bu, .adn');
    composerContainers.forEach((container) => {
        const wrappers = container.querySelectorAll('[data-ai-email-writer-button="true"]');
        if (wrappers.length > 1) {
            for (let i = 1; i < wrappers.length; i++) {
                wrappers[i].remove();
            }
        }
    });
}

function injectControls() {
    if (typeof document === 'undefined') return;
    const toolbars = findCanonicalToolbars();
    for (const toolbar of toolbars) {
        injectControlsIntoToolbar(toolbar);
    }
    cleanupDuplicateButtons();
    injectTopToolbarButton();
}

if (typeof document !== 'undefined') {
    // Document-level capture phase click listener: guarantees click is caught even if Gmail cloned the button
    document.addEventListener('click', (e) => {
        const topBtn = e.target.closest && e.target.closest('#ai-top-summarize-btn, [data-ai-top-summarize-btn="true"]');
        if (topBtn) {
            console.log('[AI Email Writer] Top Summarize button click captured at document root');
            e.preventDefault();
            e.stopPropagation();
            handleSummarize(topBtn, null);
            return;
        }

        if (activePopupInfo && !activePopupInfo.popup.contains(e.target) && !activePopupInfo.button.contains(e.target)) {
            closeActivePopup();
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (activePopupInfo) {
                closeActivePopup();
            }
            if (activeSummaryPanel) {
                closeActiveSummaryPanel();
            }
        }
    });

    window.addEventListener('scroll', () => {
        if (activePopupInfo) {
            positionPopup(activePopupInfo.popup, activePopupInfo.button);
        }
    }, true);

    window.addEventListener('resize', () => {
        if (activePopupInfo) {
            positionPopup(activePopupInfo.popup, activePopupInfo.button);
        }
    });

    window.addEventListener('hashchange', () => {
        closeActiveSummaryPanel();
        if (!isGmailConversationOpen()) {
            removeTopToolbarButton();
        } else {
            injectTopToolbarButton();
        }
    });

    window.addEventListener('popstate', () => {
        closeActiveSummaryPanel();
        if (!isGmailConversationOpen()) {
            removeTopToolbarButton();
        } else {
            injectTopToolbarButton();
        }
    });

    setInterval(() => {
        if (window.location.href !== lastKnownLocation) {
            lastKnownLocation = window.location.href;
            closeActiveSummaryPanel();
            if (!isGmailConversationOpen()) {
                removeTopToolbarButton();
            } else {
                injectTopToolbarButton();
            }
        }
    }, 500);

    const observer = new MutationObserver((mutations) => {
        let shouldCheck = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (
                        node.classList.contains('ai-reply-popup') ||
                        node.classList.contains('ai-reply-wrapper') ||
                        node.classList.contains('ai-summary-panel') ||
                        node.classList.contains('ai-top-summarize-btn')
                    )) {
                        continue;
                    }
                    if (
                        node.matches('.aDh, .btC, [role="dialog"], [role="toolbar"], .M9, [gh="mtb"], .G-atb, .D.E.G-atb, .aqL, .G-tF') ||
                        (node.querySelector && node.querySelector('.aDh, .btC, [role="dialog"], [role="toolbar"], [gh="mtb"], .G-atb, .D.E.G-atb, .aqL, .G-tF'))
                    ) {
                        shouldCheck = true;
                        break;
                    }
                }
            }
            if (shouldCheck) break;
        }

        if (shouldCheck) {
            clearTimeout(injectionDebounceTimer);
            injectionDebounceTimer = setTimeout(injectControls, 250);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    injectControls();
}

// Export helper functions for testing in Node environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUPPORTED_TONES,
        SUPPORTED_LENGTHS,
        isGmailConversationOpen,
        isComposeElement,
        extractConversationSubject,
        extractSanitizedBodyText,
        extractSenderFromNode,
        extractDateFromNode,
        formatThreadForSummary,
        parseSummarySections,
        findTopConversationToolbar,
        getTopToolbarInsertionTarget: insertTopToolbarButton, // backward compatibility
        insertTopToolbarButton,
        attachTopButtonListeners,
        removeTopToolbarButton,
        injectTopToolbarButton
    };
}