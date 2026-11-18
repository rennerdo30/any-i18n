/**
 * Offscreen document hosting the bundled Tesseract.js OCR engine (Chrome and Edge only; Firefox
 * has no offscreen API). The service worker sends { target: 'offscreen', action: 'ocr' } messages
 * with an image data URL and gets the recognized text back.
 */

// Language training data is data, not code, so loading it from the official CDN is allowed in MV3.
var TESSDATA_URL = 'https://tessdata.projectnaptha.com/4.0.0';
var DEFAULT_LANGUAGES = 'eng';

var workerPromise = null;
var workerLanguages = null;

function getWorker(languages) {
  if (workerPromise && workerLanguages === languages) return workerPromise;

  var previous = workerPromise;
  workerLanguages = languages;
  workerPromise = Promise.resolve(previous && previous.then(function(worker) {
    return worker.terminate();
  }).catch(function() {})).then(function() {
    return Tesseract.createWorker(languages.split('+').filter(Boolean), 1, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract'),
      langPath: TESSDATA_URL,
      workerBlobURL: false // Blob workers are blocked by the extension CSP
    });
  });
  // A failed start (unknown language code, offline) must not poison later requests.
  workerPromise.catch(function() {
    workerPromise = null;
    workerLanguages = null;
  });
  return workerPromise;
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || message.target !== 'offscreen' || message.action !== 'ocr') return undefined;

  getWorker(message.languages || DEFAULT_LANGUAGES).then(function(worker) {
    return worker.recognize(message.imageDataUrl);
  }).then(function(result) {
    sendResponse({ success: true, text: ((result.data && result.data.text) || '').trim() });
  }).catch(function(error) {
    sendResponse({ success: false, error: (error && error.message) || String(error) });
  });
  return true; // Async response
});
