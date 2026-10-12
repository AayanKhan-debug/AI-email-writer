const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatThreadForSummary,
    parseSummarySections,
    extractSanitizedBodyText,
    isComposeElement,
    isGmailConversationOpen,
    findTopConversationToolbar,
    getTopToolbarInsertionTarget,
    removeTopToolbarButton,
    injectTopToolbarButton
} = require('../content.js');

test('formatThreadForSummary returns empty string when no messages are provided', () => {
    assert.equal(formatThreadForSummary(null), '');
    assert.equal(formatThreadForSummary({ messages: [] }), '');
});

test('formatThreadForSummary includes subject, sender, date, and messages in order', () => {
    const threadData = {
        subject: 'Q4 Budget Review',
        hasCollapsed: false,
        messages: [
            {
                order: 1,
                sender: 'Alice Smith <alice@example.com>',
                date: 'Mon, Oct 12, 2026, 9:00 AM',
                body: 'Here is the draft budget for review.'
            },
            {
                order: 2,
                sender: 'Bob Jones',
                date: 'Mon, Oct 12, 2026, 9:15 AM',
                body: 'Looks good. Let us finalize on Friday.'
            }
        ]
    };

    const formatted = formatThreadForSummary(threadData);

    assert.match(formatted, /^Subject: Q4 Budget Review/);
    assert.match(formatted, /--- Message 1 ---/);
    assert.match(formatted, /From: Alice Smith <alice@example\.com>/);
    assert.match(formatted, /Date: Mon, Oct 12, 2026, 9:00 AM/);
    assert.match(formatted, /Here is the draft budget for review\./);

    assert.match(formatted, /--- Message 2 ---/);
    assert.match(formatted, /From: Bob Jones/);
    assert.match(formatted, /Date: Mon, Oct 12, 2026, 9:15 AM/);
    assert.match(formatted, /Looks good\. Let us finalize on Friday\./);
});

test('formatThreadForSummary appends notice when thread contains collapsed messages', () => {
    const threadData = {
        subject: 'Standup Notes',
        hasCollapsed: true,
        messages: [
            {
                order: 1,
                sender: 'Charlie',
                date: 'Oct 12',
                body: 'Working on backend tasks today.'
            }
        ]
    };

    const formatted = formatThreadForSummary(threadData);

    assert.match(formatted, /\[Notice: This email thread contains collapsed messages in Gmail that were not expanded\. Only visible messages are included below\.\]/);
});

test('formatThreadForSummary truncates thread exceeding maximum character limit', () => {
    const oversizedBody = 'Z'.repeat(50000);
    const threadData = {
        subject: 'Long Thread',
        hasCollapsed: false,
        messages: [
            {
                order: 1,
                sender: 'User',
                date: '',
                body: oversizedBody
            }
        ]
    };

    const formatted = formatThreadForSummary(threadData);

    assert.ok(formatted.length <= 49000);
    assert.match(formatted, /\[Thread truncated due to maximum length limit\]/);
});

test('parseSummarySections parses all five standard sections correctly', () => {
    const rawSummary = `
Main Points
- Reviewed quarterly sales pipeline
- Migration scheduled for November

Decisions Made
- Decided to adopt Spring Boot 4
- Postponed external audit to Q1

Action Items
- Sarah to prepare rollout checklist by Wednesday
- Alex to configure monitoring alerts

Deadlines and Important Dates
- Friday, Oct 16: Code freeze
- Monday, Nov 2: Production migration

Unanswered Questions
- Who will lead customer support during rollout?
`;

    const sections = parseSummarySections(rawSummary);

    assert.equal(sections.length, 5);
    assert.equal(sections[0].title, 'Main Points');
    assert.match(sections[0].content, /Reviewed quarterly sales pipeline/);

    assert.equal(sections[1].title, 'Decisions Made');
    assert.match(sections[1].content, /Decided to adopt Spring Boot 4/);

    assert.equal(sections[2].title, 'Action Items');
    assert.match(sections[2].content, /Sarah to prepare rollout checklist/);

    assert.equal(sections[3].title, 'Deadlines and Important Dates');
    assert.match(sections[3].content, /Friday, Oct 16: Code freeze/);

    assert.equal(sections[4].title, 'Unanswered Questions');
    assert.match(sections[4].content, /Who will lead customer support/);
});

test('parseSummarySections supports numbered and markdown-styled section headers', () => {
    const rawSummary = `
1. Main Points:
The team agreed on the scope.

2. Decisions Made:
None identified.

3. Action Items:
None identified.

4. Deadlines and Important Dates:
None identified.

5. Unanswered Questions:
None identified.
`;

    const sections = parseSummarySections(rawSummary);

    assert.equal(sections.length, 5);
    assert.equal(sections[0].title, 'Main Points');
    assert.match(sections[0].content, /The team agreed on the scope\./);
    assert.equal(sections[1].title, 'Decisions Made');
});

test('parseSummarySections falls back to overview when no section headings are matched', () => {
    const rawSummary = 'This is an unstructured summary without clear headings.';

    const sections = parseSummarySections(rawSummary);

    assert.equal(sections.length, 1);
    assert.equal(sections[0].title, 'Summary Overview');
    assert.equal(sections[0].content, 'This is an unstructured summary without clear headings.');
});

test('isComposeElement detects compose inputs and textboxes', () => {
    const textbox = {
        getAttribute: (attr) => (attr === 'role' ? 'textbox' : null),
        classList: { contains: () => false },
        closest: () => false
    };

    const contenteditable = {
        getAttribute: (attr) => (attr === 'contenteditable' ? 'true' : null),
        classList: { contains: () => false },
        closest: () => false
    };

    const regularBody = {
        getAttribute: () => null,
        classList: { contains: () => false },
        closest: () => null
    };

    assert.equal(isComposeElement(textbox), true);
    assert.equal(isComposeElement(contenteditable), true);
    assert.equal(isComposeElement(regularBody), false);
});

test('extractSanitizedBodyText rejects compose textboxes and strips signatures/quotes', () => {
    const mockTextbox = {
        getAttribute: (attr) => (attr === 'role' ? 'textbox' : null),
        classList: { contains: () => false },
        closest: () => true
    };

    assert.equal(extractSanitizedBodyText(mockTextbox), '');

    // Test sanitization of a simulated message DOM node
    const createMockNode = () => {
        const removed = [];
        return {
            getAttribute: () => null,
            classList: { contains: () => false },
            closest: () => null,
            cloneNode: () => ({
                querySelectorAll: (sel) => {
                    if (sel.includes('.gmail_signature') || sel.includes('.gmail_quote')) {
                        return [{ remove: () => removed.push(sel) }];
                    }
                    return [];
                },
                innerText: 'Hello, let us sync tomorrow.',
                textContent: 'Hello, let us sync tomorrow.'
            })
        };
    };

    const bodyNode = createMockNode();
    const result = extractSanitizedBodyText(bodyNode);
    assert.equal(result, 'Hello, let us sync tomorrow.');
});

test('isGmailConversationOpen returns false for top-level inbox folder without thread id', () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    try {
        global.window = { location: { hash: '#inbox' }, getComputedStyle: () => ({ display: 'none' }) };
        global.document = { querySelector: () => null, querySelectorAll: () => [] };

        assert.equal(isGmailConversationOpen(), false);

        global.window.location.hash = '#starred';
        assert.equal(isGmailConversationOpen(), false);

        global.window.location.hash = '#sent';
        assert.equal(isGmailConversationOpen(), false);
    } finally {
        global.window = originalWindow;
        global.document = originalDocument;
    }
});

test('isGmailConversationOpen returns true for opened thread URL hash', () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    try {
        global.window = { location: { hash: '#inbox/FMfcgzQZTCnKqwzQxbvNMLNfWqPjklMb' } };
        global.document = { querySelector: () => null, querySelectorAll: () => [] };

        assert.equal(isGmailConversationOpen(), true);

        global.window.location.hash = '#all/18c4c798725a39cd';
        assert.equal(isGmailConversationOpen(), true);
    } finally {
        global.window = originalWindow;
        global.document = originalDocument;
    }
});

test('findTopConversationToolbar identifies active conversation toolbar with action buttons', () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    try {
        global.window = {
            location: { hash: '#inbox/FMfcgzQZTCnKqwzQxbvNMLNfWqPjklMb' },
            getComputedStyle: () => ({ display: 'block' })
        };

        const mockComposeToolbar = {
            closest: (sel) => sel.includes('.M9') || sel.includes('[role="dialog"]'),
            offsetParent: {},
            querySelector: () => null
        };

        const mockConversationToolbar = {
            closest: () => null,
            offsetParent: {},
            querySelector: (sel) => {
                if (sel.includes('[act="19"]') || sel.includes('[data-tooltip*="Archive" i]')) {
                    return { tagName: 'DIV' };
                }
                return null;
            }
        };

        global.document = {
            querySelector: (sel) => {
                if (sel.includes('h2.hP')) return { offsetParent: {}, innerText: 'Subject' };
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel.includes('gh="mtb"')) {
                    return [mockComposeToolbar, mockConversationToolbar];
                }
                return [];
            }
        };

        const foundToolbar = findTopConversationToolbar();
        assert.equal(foundToolbar, mockConversationToolbar);
    } finally {
        global.window = originalWindow;
        global.document = originalDocument;
    }
});

test('injectTopToolbarButton injects button into toolbar and is strictly idempotent', () => {
    const originalWindow = global.window;
    const originalDocument = global.document;

    try {
        global.window = {
            location: { hash: '#inbox/FMfcgzQZTCnKqwzQxbvNMLNfWqPjklMb' },
            getComputedStyle: () => ({ display: 'block' })
        };

        const actionGroupChildren = [];
        const actionGroup = {
            appendChild: (el) => actionGroupChildren.push(el),
            insertBefore: (newEl, refEl) => {
                const idx = actionGroupChildren.indexOf(refEl);
                if (idx !== -1) {
                    actionGroupChildren.splice(idx, 0, newEl);
                } else {
                    actionGroupChildren.push(newEl);
                }
            },
            querySelector: () => null,
            querySelectorAll: () => []
        };

        const mockToolbar = {
            closest: () => null,
            offsetParent: {},
            querySelector: (sel) => {
                if (sel.includes('[data-ai-top-summarize-btn="true"]')) {
                    return actionGroupChildren.find(c => c.getAttribute && c.getAttribute('data-ai-top-summarize-btn') === 'true') || null;
                }
                if (sel.includes('.aqL')) {
                    return actionGroup;
                }
                if (sel.includes('[act="19"]')) {
                    return { tagName: 'DIV' };
                }
                return null;
            }
        };

        const createdElements = [];
        global.document = {
            querySelector: (sel) => {
                if (sel.includes('[data-ai-top-summarize-btn="true"]')) {
                    return actionGroupChildren.find(c => c.getAttribute && c.getAttribute('data-ai-top-summarize-btn') === 'true') || null;
                }
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel.includes('[data-ai-top-summarize-btn="true"]')) {
                    return actionGroupChildren.filter(c => c.getAttribute && c.getAttribute('data-ai-top-summarize-btn') === 'true');
                }
                if (sel.includes('gh="mtb"')) {
                    return [mockToolbar];
                }
                return [];
            },
            createElement: (tagName) => {
                const attrs = {};
                const el = {
                    tagName,
                    setAttribute: (k, v) => { attrs[k] = v; },
                    getAttribute: (k) => attrs[k] || null,
                    addEventListener: () => {},
                    remove: () => {
                        const idx = actionGroupChildren.indexOf(el);
                        if (idx !== -1) actionGroupChildren.splice(idx, 1);
                    }
                };
                createdElements.push(el);
                return el;
            }
        };

        // First injection
        injectTopToolbarButton();
        assert.equal(actionGroupChildren.length, 1);
        assert.equal(actionGroupChildren[0].getAttribute('data-ai-top-summarize-btn'), 'true');
        assert.equal(actionGroupChildren[0].getAttribute('data-tooltip'), 'Summarize this email conversation');

        // Second injection call must be idempotent: does not duplicate
        injectTopToolbarButton();
        assert.equal(actionGroupChildren.length, 1);

        // Test cleanup
        removeTopToolbarButton();
        assert.equal(actionGroupChildren.length, 0);
    } finally {
        global.window = originalWindow;
        global.document = originalDocument;
    }
});

test('insertTopToolbarButton places button immediately before the More menu', () => {
    const { insertTopToolbarButton } = require('../content.js');

    const actionChildren = [];
    const mockMoreBtn = {
        parentElement: null,
        getAttribute: () => 'More'
    };
    const mockMoreContainer = {
        parentElement: null,
        isMoreGroup: true
    };
    mockMoreBtn.parentElement = mockMoreContainer;

    const actionContainer = {
        appendChild: (el) => actionChildren.push(el),
        insertBefore: (newEl, refEl) => {
            const idx = actionChildren.indexOf(refEl);
            if (idx !== -1) {
                actionChildren.splice(idx, 0, newEl);
            } else {
                actionChildren.push(newEl);
            }
        },
        querySelector: (sel) => {
            if (sel.includes('More')) return mockMoreBtn;
            return null;
        },
        querySelectorAll: () => []
    };
    mockMoreContainer.parentElement = actionContainer;

    const mockArchive = { name: 'archive' };
    const mockLabels = { name: 'labels' };
    actionChildren.push(mockArchive, mockLabels, mockMoreContainer);

    const mockToolbar = {
        querySelector: (sel) => (sel.includes('.aqL') ? actionContainer : null)
    };

    const mockTopBtn = { id: 'ai-top-summarize-btn' };

    const placed = insertTopToolbarButton(mockToolbar, mockTopBtn);
    assert.equal(placed, true);
    // Button must be placed BEFORE mockMoreContainer, i.e., index 2 (between labels and more)
    assert.equal(actionChildren.indexOf(mockTopBtn), 2);
    assert.equal(actionChildren.indexOf(mockMoreContainer), 3);
});

test('attachTopButtonListeners attaches onclick and stops mousedown/pointerdown propagation', () => {
    const { attachTopButtonListeners } = require('../content.js');

    const mockTopBtn = {};
    attachTopButtonListeners(mockTopBtn);

    assert.equal(typeof mockTopBtn.onclick, 'function');
    assert.equal(typeof mockTopBtn.onmousedown, 'function');
    assert.equal(typeof mockTopBtn.onpointerdown, 'function');

    let mousedownStopped = false;
    mockTopBtn.onmousedown({ stopPropagation: () => { mousedownStopped = true; } });
    assert.equal(mousedownStopped, true);

    let pointerdownStopped = false;
    mockTopBtn.onpointerdown({ stopPropagation: () => { pointerdownStopped = true; } });
    assert.equal(pointerdownStopped, true);
});


