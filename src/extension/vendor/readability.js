/*
  Placeholder for Mozilla Readability.
  Run `npm install` then `npm run vendorize` to replace this file with the
  official Readability.js implementation from @mozilla/readability.
*/
(function () {
  if (globalThis.Readability) {
    return;
  }

  class Readability {
    constructor(doc) {
      this._doc = doc;
    }

    parse() {
      const doc = this._doc;
      const title = (doc && doc.title) || 'Untitled';
      const body = doc && doc.body ? doc.body.innerHTML : '';
      return {
        title,
        byline: null,
        content: body,
        excerpt: '',
        siteName: (doc && doc.location && doc.location.hostname) || '',
        length: body.length
      };
    }
  }

  globalThis.Readability = Readability;
})();
