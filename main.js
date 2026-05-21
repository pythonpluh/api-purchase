// ==UserScript==
// @name         api purchase
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  direct api call for purchasing
// @author       pythonplugin
// @match        https://www.pekora.zip/*
// @grant        none
// @run-at       document-end
// @homepageURL  https://github.com/pythonpluh/api-purchase
// ==/UserScript==

(function () {
    'use strict';

    const rawUrl = 'https://raw.githubusercontent.com/pythonpluh/api-purchase/main/src/raw.js?t=' + Date.now();

    fetch(rawUrl)
        .then(result => {
            if (!result.ok) throw new Error('HTTP ' + result.status);
            return result.text();
        })

        .then(code => {
            const element = document.createElement('script');
            element.textContent = code;

            (document.head || document.documentElement).appendChild(element);

            element.remove();
        })

        .catch(err => console.error('API Purchase loader failed:', err));
})();