/**
 * Proxy Interceptor - Roteia TODAS as requisições externas pelo proxy DataImpulse
 * 
 * Este script intercepta fetch(), XMLHttpRequest, script tags e outras requisições
 * para que TODAS as requisições externas passem pelo endpoint /proxy/ do servidor,
 * que por sua vez usa o proxy residencial da DataImpulse (Russia).
 * 
 * Deve ser carregado ANTES do SDK de anúncios.
 */
(function() {
  'use strict';

  // Domínios que NÃO devem ser proxied (domínios locais/internos)
  var BYPASS_DOMAINS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    'manus.computer',
    'manus.space',
    'manus.im',
    'api.manus.im',
    // APIs internas do app
    'monetag-postback-server-production.up.railway.app',
    'manus-analytics.com',
  ];

  // Função para verificar se uma URL é externa e deve ser proxied
  function shouldProxy(url) {
    if (!url) return false;
    try {
      var urlStr = url.toString();
      
      // Não fazer proxy de URLs relativas locais
      if (urlStr.startsWith('/') && !urlStr.startsWith('//')) return false;
      // Não fazer proxy de data: ou blob: URLs
      if (urlStr.startsWith('data:') || urlStr.startsWith('blob:') || urlStr.startsWith('javascript:')) return false;
      
      // Extrair hostname
      var hostname = '';
      if (urlStr.startsWith('//')) {
        hostname = urlStr.substring(2).split('/')[0].split('?')[0].split(':')[0];
      } else if (urlStr.startsWith('http')) {
        hostname = urlStr.split('//')[1].split('/')[0].split('?')[0].split(':')[0];
      } else {
        return false;
      }

      // Verificar se o domínio está na lista de bypass
      for (var i = 0; i < BYPASS_DOMAINS.length; i++) {
        if (hostname === BYPASS_DOMAINS[i] || hostname.endsWith('.' + BYPASS_DOMAINS[i])) {
          return false;
        }
      }
      
      // Se o hostname é o mesmo do site atual, não proxy
      if (hostname === window.location.hostname) return false;
      
      // Todas as outras requisições externas devem ser proxied
      return true;
    } catch (e) {
      return false;
    }
  }

  // Função para converter URL para URL do proxy
  function toProxyUrl(url) {
    var urlStr = url.toString();
    // Remover protocolo
    if (urlStr.startsWith('https://')) {
      urlStr = urlStr.substring(8);
    } else if (urlStr.startsWith('http://')) {
      urlStr = urlStr.substring(7);
    } else if (urlStr.startsWith('//')) {
      urlStr = urlStr.substring(2);
    }
    return '/proxy/' + urlStr;
  }

  // ===== INTERCEPTAR FETCH =====
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else if (input && input.toString) {
      url = input.toString();
    }

    if (shouldProxy(url)) {
      var proxyUrl = toProxyUrl(url);
      console.log('[PROXY] fetch:', url, '->', proxyUrl);
      if (typeof input === 'string') {
        return originalFetch.call(window, proxyUrl, init);
      } else if (input instanceof Request) {
        var newRequest = new Request(proxyUrl, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          mode: 'cors',
          credentials: input.credentials,
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          integrity: input.integrity
        });
        return originalFetch.call(window, newRequest, init);
      }
    }
    return originalFetch.call(window, input, init);
  };

  // ===== INTERCEPTAR XMLHttpRequest =====
  var originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    var urlStr = url ? url.toString() : '';
    if (shouldProxy(urlStr)) {
      var proxyUrl = toProxyUrl(urlStr);
      console.log('[PROXY] XHR:', urlStr, '->', proxyUrl);
      return originalXHROpen.call(this, method, proxyUrl, async !== undefined ? async : true, user, password);
    }
    return originalXHROpen.call(this, method, url, async !== undefined ? async : true, user, password);
  };

  // ===== INTERCEPTAR appendChild E insertBefore =====
  var originalAppendChild = Element.prototype.appendChild;
  var originalInsertBefore = Element.prototype.insertBefore;

  function interceptElement(element) {
    if (!element || !element.tagName) return element;
    var tag = element.tagName.toLowerCase();
    
    if (tag === 'script') {
      var src = element.getAttribute('src');
      if (src && shouldProxy(src)) {
        var proxyUrl = toProxyUrl(src);
        console.log('[PROXY] script:', src, '->', proxyUrl);
        element.setAttribute('src', proxyUrl);
      }
    } else if (tag === 'img') {
      var imgSrc = element.getAttribute('src');
      if (imgSrc && shouldProxy(imgSrc)) {
        var proxyUrl = toProxyUrl(imgSrc);
        console.log('[PROXY] img:', imgSrc, '->', proxyUrl);
        element.setAttribute('src', proxyUrl);
      }
    } else if (tag === 'link') {
      var href = element.getAttribute('href');
      if (href && shouldProxy(href)) {
        var proxyUrl = toProxyUrl(href);
        console.log('[PROXY] link:', href, '->', proxyUrl);
        element.setAttribute('href', proxyUrl);
      }
    } else if (tag === 'iframe') {
      var iframeSrc = element.getAttribute('src');
      if (iframeSrc && shouldProxy(iframeSrc)) {
        var proxyUrl = toProxyUrl(iframeSrc);
        console.log('[PROXY] iframe:', iframeSrc, '->', proxyUrl);
        element.setAttribute('src', proxyUrl);
      }
    }
    return element;
  }

  Element.prototype.appendChild = function(element) {
    interceptElement(element);
    return originalAppendChild.call(this, element);
  };

  Element.prototype.insertBefore = function(element, referenceElement) {
    interceptElement(element);
    return originalInsertBefore.call(this, element, referenceElement);
  };

  // ===== INTERCEPTAR createElement =====
  var originalCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName) {
    var element = originalCreateElement(tagName);
    var tag = tagName.toLowerCase();
    
    if (tag === 'script') {
      var originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      
      Object.defineProperty(element, 'src', {
        get: function() {
          return originalSrcDescriptor && originalSrcDescriptor.get ? originalSrcDescriptor.get.call(this) : this.getAttribute('src') || '';
        },
        set: function(value) {
          if (shouldProxy(value)) {
            var proxyUrl = toProxyUrl(value);
            console.log('[PROXY] script.src set:', value, '->', proxyUrl);
            if (originalSrcDescriptor && originalSrcDescriptor.set) {
              originalSrcDescriptor.set.call(this, proxyUrl);
            } else {
              this.setAttribute('src', proxyUrl);
            }
          } else {
            if (originalSrcDescriptor && originalSrcDescriptor.set) {
              originalSrcDescriptor.set.call(this, value);
            } else {
              this.setAttribute('src', value);
            }
          }
        },
        configurable: true,
        enumerable: true
      });
    }

    if (tag === 'img') {
      var originalImgSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      
      Object.defineProperty(element, 'src', {
        get: function() {
          return originalImgSrcDescriptor && originalImgSrcDescriptor.get ? originalImgSrcDescriptor.get.call(this) : this.getAttribute('src') || '';
        },
        set: function(value) {
          if (shouldProxy(value)) {
            var proxyUrl = toProxyUrl(value);
            console.log('[PROXY] img.src set:', value, '->', proxyUrl);
            if (originalImgSrcDescriptor && originalImgSrcDescriptor.set) {
              originalImgSrcDescriptor.set.call(this, proxyUrl);
            } else {
              this.setAttribute('src', proxyUrl);
            }
          } else {
            if (originalImgSrcDescriptor && originalImgSrcDescriptor.set) {
              originalImgSrcDescriptor.set.call(this, value);
            } else {
              this.setAttribute('src', value);
            }
          }
        },
        configurable: true,
        enumerable: true
      });
    }

    if (tag === 'iframe') {
      var originalIframeSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      
      Object.defineProperty(element, 'src', {
        get: function() {
          return originalIframeSrcDescriptor && originalIframeSrcDescriptor.get ? originalIframeSrcDescriptor.get.call(this) : this.getAttribute('src') || '';
        },
        set: function(value) {
          if (shouldProxy(value)) {
            var proxyUrl = toProxyUrl(value);
            console.log('[PROXY] iframe.src set:', value, '->', proxyUrl);
            if (originalIframeSrcDescriptor && originalIframeSrcDescriptor.set) {
              originalIframeSrcDescriptor.set.call(this, proxyUrl);
            } else {
              this.setAttribute('src', proxyUrl);
            }
          } else {
            if (originalIframeSrcDescriptor && originalIframeSrcDescriptor.set) {
              originalIframeSrcDescriptor.set.call(this, value);
            } else {
              this.setAttribute('src', value);
            }
          }
        },
        configurable: true,
        enumerable: true
      });
    }

    return element;
  };

  // ===== INTERCEPTAR sendBeacon =====
  if (navigator.sendBeacon) {
    var originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      if (shouldProxy(url)) {
        var proxyUrl = toProxyUrl(url);
        console.log('[PROXY] sendBeacon:', url, '->', proxyUrl);
        return originalSendBeacon(proxyUrl, data);
      }
      return originalSendBeacon(url, data);
    };
  }

  // ===== INTERCEPTAR window.open (para popups de anúncios) =====
  var originalWindowOpen = window.open;
  window.open = function(url, target, features) {
    if (url && shouldProxy(url)) {
      var proxyUrl = toProxyUrl(url);
      console.log('[PROXY] window.open:', url, '->', proxyUrl);
      return originalWindowOpen.call(window, proxyUrl, target, features);
    }
    return originalWindowOpen.call(window, url, target, features);
  };

  // ===== CONTEXTO GLOBAL =====
  window.__PROXY_CONTEXT__ = {
    enabled: true,
    country: 'RU',
    proxyHost: 'gw.dataimpulse.com',
    proxyPort: 823,
    timestamp: Date.now(),
    userAgent: navigator.userAgent
  };

  console.log('[PROXY] Interceptor ativo - TODAS as requisições externas serão roteadas via proxy DataImpulse (Russia)');
})();
