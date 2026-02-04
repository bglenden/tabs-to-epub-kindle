(function () {
  if (window.TabToEpubTest) {
    return;
  }

  function send(message: TestMessage): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        resolve(response as TestResponse);
      });
    });
  }

  window.TabToEpubTest = { send };
})();
