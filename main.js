// ==UserScript==
// @name         api purchase
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  direct api call for purchasing
// @author       pythonplugin
// @match        https://www.pekora.zip/*
// @grant        none
// @run-at       document-end
// @require      https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
// @updateURL    https://raw.githubusercontent.com/pythonpluh/api-purchase/main/main.js
// @downloadURL  https://raw.githubusercontent.com/pythonpluh/api-purchase/main/main.js
// @homepageURL  https://github.com/pythonpluh/api-purchase
// ==/UserScript==

(function () {
    'use strict';

    const info = {
        version: '2.4',
        author: '@pythonplugin',
    };

    const state = {
        session: { 
            lastUrl: location.href, 
            cachedCsrf: null 
        },

        dom: { 
            observer: null, 
            retryTimer: null 
        },

        turnstile: { 
            widget: null, 
            callback: null 
        },

        token: { 
            pending: null, 
            promise: null, 

            at: 0 
        },

        currency: { 
            pending: null, 
            promise: null 
        },

        ticket: { 
            pending: null, 
            promise: null,

            at: 0, 

            itemId: null 
        },
    };

    // helpers
    const getItemId = () => {
        const match = window.location.pathname.match(/\/catalog\/(\d+)/);
        return match ? match[1] : null;
    };

    const getCsrf = () => {
        if (state.session.cachedCsrf) {
            return state.session.cachedCsrf;
        }

        for (const cookie of document.cookie.split(';')) {
            const [name, value] = cookie.trim().split('=');

            if (name.toLowerCase().includes('csrf')) {
                state.session.cachedCsrf = value;
                return value;
            }
        }

        const meta = document.querySelector('meta[name="csrf-token"]');
        state.session.cachedCsrf = meta ? meta.getAttribute('content') : null;

        return state.session.cachedCsrf;
    };

    const getPrice = () => {
        const label = document.querySelector('.priceLabel-0-2-61') || document.querySelector('[class*="priceLabel"]');

        if (!label) {
            return 0;
        }

        const cleaned = label.textContent.trim().replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    };

    const getCurrency = async (itemId) => {
        const label = document.querySelector('.priceLabel-0-2-61') || document.querySelector('[class*="priceLabel"]');
        const buyButton = document.querySelector('button[class*="buyBtn"]');

        const purchaseArea =
            label?.parentElement?.parentElement ||
            buyButton?.parentElement;

        if (purchaseArea) {
            const elements = purchaseArea.querySelectorAll('*');

            for (const element of elements) {
                const currencyHint = [
                    element.className,
                    element.src,
                    element.alt,
                    element.getAttribute('data-currency'),
                ].join(' ').toLowerCase();

                if (currencyHint.includes('tix') || currencyHint.includes('ticket')) {
                    return 2;
                }

                if (currencyHint.includes('robux')) {
                    return 1;
                }
            }

            for (const element of elements) {
                let currencyHint = '';

                try {
                    currencyHint = getComputedStyle(element).backgroundImage.toLowerCase();
                } catch {}

                if (currencyHint.includes('tix') || currencyHint.includes('ticket')) {
                    return 2;
                }

                if (currencyHint.includes('robux')) {
                    return 1;
                }
            }
        }

        return 1;
    };

    const getSellerId = () => {
        const sellerLink = document.querySelector('a[href*="/User.aspx?ID="]');
        if (sellerLink) {
            const match = sellerLink.href.match(/ID=(\d+)/);

            if (match) {
                return parseInt(match[1]);
            }
        }

        return 1;
    };

    const waitForTurnstile = async () => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            if (window.turnstile?.render && window.turnstile?.execute) {
                return true;
            }

            await new Promise(r => setTimeout(r, 150));
        }

        return false;
    };

    const initWidget = () => {
        if (state.turnstile.widget) {
            return state.turnstile.widget;
        }

        // turnstile init
        const container = document.createElement('div');
        container.style.cssText = 'position: fixed; opacity: 0; pointer-events: none; z-index: -9999';
        document.body.appendChild(container);

        state.turnstile.widget = window.turnstile.render(container, {
            sitekey: '0x4AAAAAADQcZgwHYAGOlwRV', // lol

            appearance: 'execute',
            execution: 'execute',

            callback: (token) => {
                if (state.turnstile.callback) {
                    state.turnstile.callback(token);
                    state.turnstile.callback = null;
                }
            },

            'error-callback': () => {
                if (state.turnstile.callback) {
                    state.turnstile.callback(null);
                    state.turnstile.callback = null;
                }
            },
        });

        return state.turnstile.widget;
    };

    const requestToken = async () => {
        const ready = await waitForTurnstile();
        if (!ready) {
            throw new Error('turnstile script never loaded');
        }

        initWidget();

        if (!state.turnstile.widget || !window.turnstile?.execute) {
            throw new Error('turnstile not ready');
        }

        return new Promise((resolve, reject) => {
            const myCallback = (token) => {
                if (!token) {
                    reject(new Error('turnstile returnd null'));
                } else {
                    resolve(token);
                }
            };

            state.turnstile.callback = myCallback;

            try {
                try {
                    window.turnstile.reset(state.turnstile.widget);
                } catch {}

                window.turnstile.execute(state.turnstile.widget);
            } catch (result) {
                state.turnstile.callback = null;
                reject(result);

                return;
            }

            setTimeout(() => {
                if (state.turnstile.callback === myCallback) {
                    state.turnstile.callback = null;
                }

                reject(new Error('turnstile timeout'));
            }, 15000);
        });
    };

    let tokenInflight = null;
    const getToken = () => {
        if (tokenInflight) {
            return tokenInflight;
        }

        tokenInflight = requestToken().finally(() => {
            tokenInflight = null;
        });

        return tokenInflight;
    };

    const prefetchToken = () => {
        if (document.hidden) {
            return;
        }

        if (state.token.pending && Date.now() - state.token.at >= 240000) {
            state.token.pending = null;
            state.token.at = 0;
        }

        if (state.token.promise || state.token.pending) {
            return;
        }

        state.token.promise = getToken()
            .then(token => {
                state.token.pending = token;
                state.token.at = Date.now();
                state.token.promise = null;

                return token;
            })

            .catch(result => {
                console.warn('prefetch failed:', result.message);
                state.token.promise = null;

                return null;
            });
    };

    const prefetchCurrency = (itemId) => {
        if (state.currency.promise || state.currency.pending) {
            return;
        }

        state.currency.promise = getCurrency(itemId)
            .then(currency => {
                state.currency.pending = currency;
                return currency;
            })

            .catch(result => {
                console.warn('currency prefetch failed:', result.message);
                state.currency.promise = null;

                return null;
            });
    };

    const getOrFetchCurrency = async (itemId) => {
        if (state.currency.pending) {
            const currency = state.currency.pending;
            state.currency.pending = null;

            return currency;
        }

        if (state.currency.promise) {
            const currency = await state.currency.promise.catch(() => null);
            state.currency.promise = null;

            if (currency) {
                return currency;
            }
        }

        return await getCurrency(itemId);
    };

    const prefetchHandshake = (itemId) => {
        if (document.hidden) {
            return;
        }

        if (state.ticket.pending && state.ticket.itemId === itemId && Date.now() - state.ticket.at >= 20000) {
            state.ticket.pending = null;
            state.ticket.at = 0;
        }

        if (state.ticket.promise || (state.ticket.pending && state.ticket.itemId === itemId)) {
            return;
        }

        if (state.ticket.itemId !== itemId) {
            state.ticket.pending = null;
            state.ticket.at = 0;
            state.ticket.promise = null;
        }

        state.ticket.itemId = itemId;

        state.ticket.promise = doHandshake(itemId)
            .then(ticket => {
                state.ticket.pending = ticket;
                state.ticket.at = Date.now();
                state.ticket.promise = null;

                return ticket;
            })

            .catch(result => {
                console.warn('handshake prefetch failed:', result.message);
                state.ticket.promise = null;

                return null;
            });
    };

    const getOrFetchTicket = async (itemId) => {
        if (state.ticket.pending && state.ticket.itemId === itemId && Date.now() - state.ticket.at < 30000) {
            const ticket = state.ticket.pending;
            state.ticket.pending = null;
            state.ticket.at = 0;

            return ticket;
        }

        state.ticket.pending = null;
        state.ticket.at = 0;

        if (state.ticket.promise && state.ticket.itemId === itemId) {
            const ticket = await state.ticket.promise.catch(() => null);
            state.ticket.promise = null;

            if (ticket) {
                return ticket;
            }
        }

        return await doHandshake(itemId);
    };

    const resetToken = () => {
        state.token.pending = null;
        state.token.promise = null;
        state.token.at = 0;

        state.ticket.pending = null;
        state.ticket.promise = null;
        state.ticket.at = 0;
        
        state.turnstile.callback = null;

        if (state.turnstile.widget && window.turnstile?.reset) {
            try {
                window.turnstile.reset(state.turnstile.widget);
            } catch {}
        }

        prefetchToken();
    };

    const getOrFetchToken = async () => {
        if (state.token.pending && Date.now() - state.token.at < 240000) {
            const token = state.token.pending;
            state.token.pending = null;
            state.token.at = 0;

            prefetchToken();
            
            return token;
        }

        state.token.pending = null;
        state.token.at = 0;

        if (state.token.promise) {
            const token = await state.token.promise.catch(() => null);
            state.token.promise = null;

            if (token) {
                return token;
            }
        }

        return await getToken();
    };

    // main
    const doHandshake = async (assetId, retry = true) => {
        const token = await getOrFetchToken();
        if (!token) {
            throw new Error('ts token missing');
        }

        const response = await fetch(
            `https://www.pekora.zip/apisite/economy/v1/purchases/products/${assetId}/handshake`,
            {
                method: 'POST',
                mode: 'same-origin',
                credentials: 'include',
                priority: 'high',

                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'content-type': 'application/json',
                    'x-csrf-token': getCsrf(),
                    'origin': 'https://www.pekora.zip',
                    'referer': location.href,
                },

                body: JSON.stringify({ tToken: token }),
            }
        );

        if (!response.ok) {
            if (retry && (response.status === 400 || response.status === 403)) {
                state.token.pending = null;
                state.token.promise = null;
                state.token.at = 0;
                
                state.session.cachedCsrf = null;

                return doHandshake(assetId, false);
            }

            throw new Error(`handshake failed: ${response.status}`);
        }

        const data = await response.json();
        const ticket =
            data.ticket ||
            data.koroneTicket ||
            data.xKoroneTicket ||
            data.token ||
            data.nonce;

        if (!ticket) {
            throw new Error(`no ticket: ${JSON.stringify(data)}`);
        }

        return ticket;
    };

    const notify = (message, isSuccess = true) => {
        const notification = document.createElement('div');
        notification.textContent = message;

        notification.style.cssText = `
            position: fixed;
            top: 0;
            left: 50%;
            z-index: 9999;
            background: ${isSuccess ? 'rgb(0, 167, 107)' : 'rgb(214, 91, 91)'};
            color: white;
            padding: 12px 16px;
            width: 100%;
            max-width: 970px;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-align: center;
            box-sizing: border-box;
            transition: transform 0.4s ease;
            transform: translate(-50%, -100%);
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
        `;

        document.body.appendChild(notification);
        notification.getBoundingClientRect();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                notification.style.transform = 'translate(-50%, 56px)';
            });
        });

        setTimeout(() => {
            notification.style.transform = 'translate(-50%, -100%)';
            notification.addEventListener('transitionend', () => notification.remove(), { once: true });
        }, 7000);
    };

    const purchase = async (itemId, price = 0) => {
        try {
            const sellerId = getSellerId();

            const [currency, ticket] = await Promise.all([
                getOrFetchCurrency(itemId),
                getOrFetchTicket(itemId),
            ]);
            
            const response = await fetch(
                `https://www.pekora.zip/apisite/economy/v1/purchases/products/${itemId}`,
                {
                    method: 'POST',
                    mode: 'same-origin',
                    credentials: 'include',
                    priority: 'high',
                    keepalive: true,

                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'content-type': 'application/json;charset=UTF-8',
                        'x-csrf-token': state.session.cachedCsrf || getCsrf(),
                        'x-korone-ticket': ticket,
                        'referer': location.href,
                        'origin': 'https://www.pekora.zip',
                    },

                    body: JSON.stringify({
                        assetId: parseInt(itemId),
                        expectedPrice: price,
                        expectedSellerId: sellerId,
                        expectedCurrency: currency,

                        userAssetId: null,
                    }),
                }
            );

            const rawText = await response.text();
            let data = {};

            try {
                data = JSON.parse(rawText);
            } catch {
                console.log('ok fuck you');
            }

            if (response.ok && data.purchased) {
                notify('API Purchase completed');

                setTimeout(() =>
                    location.reload(),
                    300);
            } else {
                resetToken();

                notify(`API Purchase failed: ${data.errors?.[0]?.message || rawText}`, false);
            }
        } catch (error) {
            resetToken();

            notify(`error: ${error.message}`, false);
        }
    };

    const purchase_button = () => {
        const itemId = getItemId();
        if (!itemId) {
            return false;
        }

        if (document.querySelector('#yieldsponsoredbutton')) {
            return true;
        }

        const buyButton = document.querySelector('button[class*="buyBtn"]');
        if (!buyButton || buyButton.disabled || buyButton.textContent.toLowerCase().includes('edit avatar')) {
            return false;
        }

        const buttonText = buyButton.textContent.trim().toLowerCase();
        if (buttonText === 'back' || buttonText === 'home') {
            return false;
        }

        const buttonContainer = buyButton.parentElement;
        if (!buttonContainer) {
            return false;
        }

        prefetchToken();
        prefetchCurrency(itemId);
        prefetchHandshake(itemId);

        const button = document.createElement('button');
        button.id = 'yieldsponsoredbutton';
        button.type = 'button';
        button.textContent = 'API Purchase';

        button.style.cssText = `
            background: rgb(0, 167, 107) !important;
            color: white !important;
            margin-top: 6px;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            height: 40px;
            letter-spacing: 0.5px;
            transition: all 0.25s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
        `;

        button.onmouseenter = () => {
            if (!button.disabled) {
                button.style.background = 'rgb(0, 132, 86)';
                button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.25)';
            }

            prefetchToken();
            prefetchHandshake(itemId);
        };

        button.onmouseleave = () => {
            if (!button.disabled) {
                button.style.background = 'rgb(0, 167, 107)';
                button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            }
        };

        button.onclick = (event) => event.preventDefault();

        button.onpointerdown = async (event) => {
            event.preventDefault();

            if (button.disabled || event.button !== 0) {
                return;
            }

            button.disabled = true;
            button.textContent = 'Processing...';
            button.style.background = '#888 !important';
            button.style.cursor = 'not-allowed';
            button.style.opacity = '0.75';
            button.style.transform = 'scale(0.97)';
            button.style.boxShadow = 'none';

            try {
                await purchase(getItemId(), getPrice());
            } finally {
                button.disabled = false;
                button.textContent = 'API Purchase';
                button.style.background = 'rgb(0, 167, 107) !important';
                button.style.cursor = 'pointer';
                button.style.opacity = '1';
                button.style.transform = 'scale(1)';
                button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            }
        };

        // dis got into the way with the button so i jus moved it down a lil
        const saleClock = buttonContainer.querySelector('[class*="saleClockContainer"]');
        if (saleClock) {
            saleClock.style.cssText += '; position: relative; top: auto; left: auto; right: auto; bottom: auto;';
            buttonContainer.insertBefore(button, saleClock);
        } else {
            buttonContainer.appendChild(button);
        }

        return true;
    };

    const start_retry = () => {
        if (state.dom.retryTimer) {
            clearTimeout(state.dom.retryTimer);
            state.dom.retryTimer = null;
        }

        let attempts = 0;
        const retry = () => {
            if (!getItemId()) {
                return;
            }

            if (purchase_button()) {
                return;
            }

            if (++attempts < 20) {
                state.dom.retryTimer = setTimeout(retry, 300);
            }
        };

        retry();
    };

    const monitor_button = () => {
        if (state.dom.observer) {
            state.dom.observer.disconnect();
        }

        let debounceTimer = null;
        state.dom.observer = new MutationObserver(() => {
            if (debounceTimer) {
                return;
            }

            debounceTimer = setTimeout(() => {
                debounceTimer = null;

                const existing = document.querySelector('#yieldsponsoredbutton');
                const buyButton = document.querySelector('button[class*="buyBtn"]');

                if (existing && (!getItemId() || !buyButton || existing.parentElement !== buyButton.parentElement)) {
                    existing.remove();
                    return;
                }

                if (getItemId() && !existing) {
                    purchase_button();
                }
            }, 50);
        });

        state.dom.observer.observe(document.body, { childList: true, subtree: true });
    };

    const history_navigation = () => {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        const onNavigate = () => {
            const currentUrl = location.href;
            if (currentUrl === state.session.lastUrl) {
                return;
            }

            state.session.lastUrl = currentUrl;

            state.token.pending = null;
            state.token.promise = null;
            state.token.at = 0;

            state.currency.pending = null;
            state.currency.promise = null;

            state.ticket.pending = null;
            state.ticket.promise = null;
            state.ticket.itemId = null;
            state.ticket.at = 0;

            state.session.cachedCsrf = null;
        };

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            onNavigate();
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            onNavigate();
        };

        window.addEventListener('popstate', onNavigate);
    };

    // set up
    const setup = () => {
        console.log(`%c

                            ██                                                       ▄▄
                            ▀▀                                                       ██
      ▄█████▄  ██▄███▄    ████               ██▄███▄   ██    ██   ██▄████   ▄█████▄  ██▄████▄   ▄█████▄  ▄▄█████▄   ▄████▄
      ▀ ▄▄▄██  ██▀  ▀██     ██               ██▀  ▀██  ██    ██   ██▀      ██▀    ▀  ██▀   ██   ▀ ▄▄▄██  ██▄▄▄▄ ▀  ██▄▄▄▄██
     ▄██▀▀▀██  ██    ██     ██               ██    ██  ██    ██   ██       ██        ██    ██  ▄██▀▀▀██   ▀▀▀▀██▄  ██▀▀▀▀▀▀
     ██▄▄▄███  ███▄▄██▀  ▄▄▄██▄▄▄            ███▄▄██▀  ██▄▄▄███   ██       ▀██▄▄▄▄█  ██    ██  ██▄▄▄███  █▄▄▄▄▄██  ▀██▄▄▄▄█
      ▀▀▀▀ ▀▀  ██ ▀▀▀    ▀▀▀▀▀▀▀▀            ██ ▀▀▀     ▀▀▀▀ ▀▀   ▀▀         ▀▀▀▀▀   ▀▀    ▀▀   ▀▀▀▀ ▀▀   ▀▀▀▀▀▀     ▀▀▀▀▀
               ██                            ██

     %cversion:%c  ${info.version}                               %cauthor:%c  ${info.author}                               %cloaded in:%c  ${(performance.now() / 1000).toFixed(3)}s
    `,
            'color: #00a76b;',
            'color: #ffffff; font-weight: bold; background: #00a76b; padding: 2px 6px; border-radius: 3px;', 'color: #ffffff;',
            'color: #ffffff; font-weight: bold; background: #00a76b; padding: 2px 6px; border-radius: 3px;', 'color: #ffffff;',
            'color: #ffffff; font-weight: bold; background: #00a76b; padding: 2px 6px; border-radius: 3px;', 'color: #ffffff;',
        );

        console.log('API purchase initialized, thank you for using this extension!')

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                start_retry();
                monitor_button();
            });
        } else {
            start_retry();
            monitor_button();
        }

        const warmup = () => {
            const itemId = getItemId();

            if (!document.hidden && itemId && document.querySelector('#yieldsponsoredbutton')) {
                prefetchToken();
                prefetchHandshake(itemId);
            }
        };

        document.addEventListener('visibilitychange', warmup);
        setInterval(warmup, 20000);

        history_navigation();
    };

    setup();
})();