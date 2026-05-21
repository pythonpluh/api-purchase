(function () {
    'use strict';

    const info = {
        version: '2.0',
        author: '@pythonplugin',
    };

    let lastUrl = location.href;

    let domObserver = null;
    let retryTimer = null;

    let turnstileCallback = null;
    let turnstileWidget = null;

    let pendingToken = null;
    let tokenPromise = null;

    let cachedCsrf = null;

    // helpers
    const getItemId = () => {
        const match = window.location.pathname.match(/\/catalog\/(\d+)/);
        return match ? match[1] : null;
    };

    const getCsrf = () => {
        if (cachedCsrf) return cachedCsrf;

        for (const cookie of document.cookie.split(';')) {
            const [name, value] = cookie.trim().split('=');

            if (name.toLowerCase().includes('csrf')) {
                cachedCsrf = value;
                return value;
            }
        }

        const meta = document.querySelector('meta[name="csrf-token"]');
        cachedCsrf = meta ? meta.getAttribute('content') : null;

        return cachedCsrf;
    };

    const getPrice = () => {
        const label =
            document.querySelector('.priceLabel-0-2-61') ||
            document.querySelector('[class*="priceLabel"]');

        if (!label) {
            return 0;
        }

        const cleaned = label.textContent.trim().replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
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

    const initializeTurnstile = () => {
        const container = document.createElement('div');
        container.style.cssText = 'position: fixed; opacity: 0; pointer-events: none; z-index: -9999';

        document.body.appendChild(container);

        turnstileWidget = window.turnstile.render(container, {
            sitekey: '0x4AAAAAADQcZgwHYAGOlwRV', // lol

            appearance: 'execute',
            execution: 'execute',

            callback: (token) => {
                if (turnstileCallback) {
                    turnstileCallback(token);
                    turnstileCallback = null;
                }
            },

            'error-callback': () => {
                if (turnstileCallback) {
                    turnstileCallback(null);
                    turnstileCallback = null;
                }
            },
        });
    };

    const getTurnstileToken = async () => {
        const deadline = Date.now() + 8000;

        while (Date.now() < deadline) {
            if (window.turnstile?.render) {
                if (!turnstileWidget) initializeTurnstile();
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (!turnstileWidget || !window.turnstile?.execute) {
            throw new Error('turnstile not ready');
        }

        return new Promise((resolve, reject) => {
            turnstileCallback = resolve;
            window.turnstile.execute(turnstileWidget);

            setTimeout(() => {
                if (turnstileCallback === resolve) {
                    turnstileCallback = null;
                    reject(new Error('turnstile timeout'));
                }
            }, 8000);
        });
    };

    const prefetchToken = () => {
        tokenPromise = getTurnstileToken()
            .then(token => {
                pendingToken = token;
                return token;
            })

            .catch(() => null);
    };

    const getOrFetchToken = async () => {
        if (pendingToken) {
            const token = pendingToken;
            pendingToken = null;

            tokenPromise = getTurnstileToken()
                .then(token => { pendingToken = token; return token; })
                .catch(() => null);

            return token;
        }

        return tokenPromise ?? getTurnstileToken();
    };

    // main
    const doHandshake = async (assetId) => {
        const token = await getOrFetchToken();
        if (!token) throw new Error('ts token missing');

        const response = await fetch(
            `https://www.pekora.zip/apisite/economy/v1/purchases/products/${assetId}/handshake`,
            {
                method: 'POST',
                mode: 'same-origin',
                credentials: 'include',

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

        if (!response.ok) throw new Error(`handshake failed: ${response.status}`);

        const data = await response.json();
        const ticket =
            data.ticket ||
            data.koroneTicket ||
            data.xKoroneTicket ||
            data.token ||
            data.nonce;

        if (!ticket) throw new Error(`no ticket: ${JSON.stringify(data)}`);

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
            const ticket = await doHandshake(itemId);

            const response = await fetch(
                `https://www.pekora.zip/apisite/economy/v1/purchases/products/${itemId}`,
                {
                    method: 'POST',
                    mode: 'same-origin',
                    credentials: 'include',

                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'content-type': 'application/json;charset=UTF-8',
                        'x-csrf-token': cachedCsrf || getCsrf(),
                        'x-korone-ticket': ticket,
                        'referer': location.href,
                        'origin': 'https://www.pekora.zip',
                    },

                    body: JSON.stringify({
                        assetId: parseInt(itemId),
                        expectedPrice: price,
                        expectedSellerId: sellerId,
                        expectedCurrency: 1,

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
                    1500);
            } else {
                notify(`API Purchase failed: ${data.reason || rawText}`, false);
            }
        } catch (error) {
            pendingToken = null;
            tokenPromise = null;

            notify(`error: ${error.message}`, false);
        }
    };

    const purchase_button = () => {
        const itemId = getItemId();
        if (!itemId) return false;

        if (document.querySelector('#yieldsponsoredbutton')) return true;

        const buyButton = document.querySelector('button[class*="buyBtn"]');
        if (
            !buyButton ||
            buyButton.disabled ||
            buyButton.textContent.toLowerCase().includes('edit avatar')
        ) {
            return false;
        }

        const buttonContainer = buyButton.parentElement;
        if (!buttonContainer) return false;

        prefetchToken();

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
        };

        button.onmouseleave = () => {
            if (!button.disabled) {
                button.style.background = 'rgb(0, 167, 107)';
                button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            }
        };

        button.onclick = async (event) => {
            event.preventDefault();

            if (button.disabled) return;

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
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        let attempts = 0;
        const retry = () => {
            if (!getItemId()) return;

            if (purchase_button()) return;

            if (++attempts < 20) {
                retryTimer = setTimeout(retry, 300);
            }
        };

        retry();
    };

    const monitor_button = () => {
        if (domObserver) domObserver.disconnect();

        let debounceTimer = null;
        domObserver = new MutationObserver(() => {
            if (debounceTimer) return;

            debounceTimer = setTimeout(() => {
                debounceTimer = null;

                if (getItemId() && !document.querySelector('#yieldsponsoredbutton')) {
                    purchase_button();
                }
            }, 50);
        });

        domObserver.observe(document.body, { childList: true, subtree: true });
    };

    const history_navigation = () => {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        const onNavigate = () => {
            const currentUrl = location.href;
            if (currentUrl === lastUrl) return;

            lastUrl = currentUrl;

            pendingToken = null;
            tokenPromise = null;

            cachedCsrf = null;
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

        console.log('API purchase initialized, thanks for using this extension!')

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                start_retry();
                monitor_button();
            });
        } else {
            start_retry();
            monitor_button();
        }

        history_navigation();
    };

    setup();
})();
